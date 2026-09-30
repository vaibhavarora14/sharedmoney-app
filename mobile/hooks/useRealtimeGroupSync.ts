import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { InfiniteData } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { queryKeys } from "./queryKeys";
import type { TransactionsPageResponse } from "./useTransactions";
import { log } from "../utils/logger";
import { recordSentryRealtimeChannel } from "../utils/sentryTelemetry";

interface UseRealtimeGroupSyncOptions {
  enabled?: boolean;
}

/** Id-only delete signal. Full-row create/update pushes are no longer emitted. */
export interface TransactionDeletePushPayload {
  action: "delete";
  groupId: string;
  transactionId: number;
}

function isTransactionDeletePush(
  payload: unknown
): payload is TransactionDeletePushPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    p.action === "delete" &&
    typeof p.groupId === "string" &&
    typeof p.transactionId === "number" &&
    Number.isFinite(p.transactionId)
  );
}

/**
 * Real-time synchronization for a group session.
 *
 * - TRANSACTION_PUSHED: id-only delete → drop the row from the feed cache and
 *   invalidate balances / stats / activity.
 * - DATA_MUTATED + CDC insert/update: debounced invalidate so members refetch
 *   over authenticated HTTP (no full ledger rows on the broadcast wire).
 *
 * Channel is private; membership requires realtime.messages RLS applied from
 * supabase/manual/realtime_messages_group_sync_rls.sql (not via db push).
 */
export function useRealtimeGroupSync(
  groupId: string | null | undefined,
  options: UseRealtimeGroupSyncOptions = {},
) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!groupId || !enabled) return;

    const handleTransactionDeletePush = (payload: TransactionDeletePushPayload) => {
      if (payload.groupId !== groupId) return;
      log(`[Realtime Push] Applying transaction delete for group ${groupId}`);

      const delId = payload.transactionId;
      queryClient.setQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId),
        (old) => {
          if (!old || !old.pages?.length) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== delId),
            })),
          };
        }
      );

      queryClient.invalidateQueries({ queryKey: queryKeys.balances(groupId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.groupStats(groupId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(groupId) });
    };

    // Pull fallback: debounced cache invalidation
    const invalidateGroupData = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        log(`[Realtime Pull Fallback] Syncing updates for group ${groupId}`);
        queryClient.invalidateQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.balances(groupId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.settlements(groupId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.activity(groupId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.groupStats(groupId) });
      }, 150);
    };

    const channelName = `group-sync:${groupId}`;
    recordSentryRealtimeChannel("subscribe", groupId);
    const channel = supabase
      .channel(channelName, {
        config: {
          // Membership-gated via realtime.messages RLS (see supabase/manual/).
          private: true,
        },
      })
      // 1. Postgres CDC for raw changes
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "transactions",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const deletedId = (payload.old as { id?: number })?.id;
          if (deletedId) {
            handleTransactionDeletePush({
              action: "delete",
              groupId,
              transactionId: deletedId,
            });
          } else {
            invalidateGroupData();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `group_id=eq.${groupId}`,
        },
        () => invalidateGroupData()
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "transactions",
          filter: `group_id=eq.${groupId}`,
        },
        () => invalidateGroupData()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "settlements",
          filter: `group_id=eq.${groupId}`,
        },
        () => invalidateGroupData()
      )
      // 2. Id-only delete push (create/update use DATA_MUTATED instead)
      .on(
        "broadcast",
        { event: "TRANSACTION_PUSHED" },
        (payload) => {
          if (isTransactionDeletePush(payload?.payload)) {
            handleTransactionDeletePush(payload.payload);
          }
        }
      )
      // 3. Generic invalidation signal (id-only; no ledger bodies)
      .on(
        "broadcast",
        { event: "DATA_MUTATED" },
        (payload) => {
          if (payload?.payload?.groupId === groupId) {
            invalidateGroupData();
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          log(`[Realtime] Connected to channel for group ${groupId}`);
        }
      });

    // AppState lifecycle: flush stale queries when app returns to foreground
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        invalidateGroupData();
      }
    };

    const appStateSub = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      appStateSub.remove();
      recordSentryRealtimeChannel("unsubscribe", groupId);
      void supabase.removeChannel(channel);
    };
  }, [groupId, enabled, queryClient]);
}
