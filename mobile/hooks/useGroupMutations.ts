import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { Group, GroupWithMembers } from "../types";
import { fetchWithAuth } from "../utils/api";
import {
  captureAnalyticsEvent,
  captureIdentifiedAnalyticsEvent,
} from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { queryKeys } from "./queryKeys";

function invalidateGroupAdjacents(queryClient: QueryClient, groupId?: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.groups });
  if (!groupId) return;
  queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.groupStats(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.balances(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.activity(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.invitations(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.settlements(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.participants(groupId) });
}

export function useCreateGroup(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const mutation = useMutation({
    mutationFn: async (groupData: { name: string; description?: string }) => {
      const response = await fetchWithAuth("/groups", {
        method: "POST",
        body: JSON.stringify(groupData),
      });

      if (!response.ok) {
        throw new Error("Failed to create group");
      }

      return response.json();
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      if (result?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.group(result.id) });
      }
      // Ensure distinct_id is the signed-in auth user before activation capture.
      captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.GROUP_CREATED, {
        has_description: Boolean(variables.description),
        ...(result?.id ? { group_id: result.id } : {}),
      });
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

async function updateMembershipVisibility(
  groupId: string,
  action: "archive" | "unarchive" | "hide"
) {
  const response = await fetchWithAuth(`/groups/${groupId}/${action}`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const fallback =
      action === "hide"
        ? "Failed to remove group from your lists"
        : action === "unarchive"
          ? "Failed to unarchive group"
          : "Failed to archive group";
    throw new Error(errorData.error || fallback);
  }

  return response.json() as Promise<{
    group_id: string;
    status: string | null;
    archived_at: string | null;
    hidden_at: string | null;
  }>;
}

export function useArchiveGroup(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (groupId: string) =>
      updateMembershipVisibility(groupId, "archive"),
    onSuccess: (result) => {
      invalidateGroupAdjacents(queryClient, result.group_id);
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        (current || []).map((item) =>
          item.id === result.group_id
            ? { ...item, archived_at: result.archived_at, hidden_at: result.hidden_at }
            : item
        )
      );
      captureAnalyticsEvent(ANALYTICS_EVENTS.GROUP_ARCHIVED, {});
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useUnarchiveGroup(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (groupId: string) =>
      updateMembershipVisibility(groupId, "unarchive"),
    onSuccess: (result) => {
      invalidateGroupAdjacents(queryClient, result.group_id);
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        (current || []).map((item) =>
          item.id === result.group_id
            ? { ...item, archived_at: result.archived_at, hidden_at: result.hidden_at }
            : item
        )
      );
      captureAnalyticsEvent(ANALYTICS_EVENTS.GROUP_UNARCHIVED, {});
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useHideGroupFromLists(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (groupId: string) =>
      updateMembershipVisibility(groupId, "hide"),
    onSuccess: (result) => {
      invalidateGroupAdjacents(queryClient, result.group_id);
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        (current || []).filter((item) => item.id !== result.group_id)
      );
      captureAnalyticsEvent(ANALYTICS_EVENTS.GROUP_HIDDEN_FROM_LISTS, {});
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useUpdateGroup(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (variables: {
      groupId: string;
      name?: string;
      description?: string | null;
    }) => {
      const payload: Record<string, string | null> = {};

      if (variables.name !== undefined) {
        payload.name = variables.name;
      }

      if (variables.description !== undefined) {
        payload.description = variables.description;
      }

      if (Object.keys(payload).length === 0) {
        throw new Error("Please provide a name or description to update");
      }

      const response = await fetchWithAuth(`/groups/${variables.groupId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      return response.json() as Promise<Group>;
    },
    onSuccess: (result, variables) => {
      invalidateGroupAdjacents(queryClient, variables.groupId);
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        (current || []).map((item) =>
          item.id === result.id ? { ...item, ...result } : item
        )
      );
      queryClient.setQueryData<GroupWithMembers | null>(
        queryKeys.group(variables.groupId),
        (current) => (current ? { ...current, ...result } : current)
      );
      captureAnalyticsEvent(ANALYTICS_EVENTS.GROUP_UPDATED, {
        updated_name: variables.name !== undefined,
        updated_description: variables.description !== undefined,
      });
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useAddMember(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (variables: {
      groupId: string;
      fullName?: string;
      email?: string | null;
      phone?: string | null;
      countryCode?: string | null;
      sourceParticipantId?: string;
    }) => {
      const response = await fetchWithAuth(
        variables.phone ? "/group-members" : "/participants",
        {
          method: "POST",
          body: JSON.stringify(
            variables.phone
              ? {
                group_id: variables.groupId,
                phone: variables.phone,
                country_code: variables.countryCode || null,
              }
              : {
                group_id: variables.groupId,
                ...(variables.sourceParticipantId
                  ? { source_participant_id: variables.sourceParticipantId }
                  : {
                    full_name: variables.fullName,
                    email: variables.email || null,
                  }),
              },
          ),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to add person");
      }

      return response.status === 204 ? null : await response.json();
    },
    onSuccess: (_data, variables) => {
      invalidateGroupAdjacents(queryClient, variables.groupId);
      queryClient.invalidateQueries({ queryKey: ["existing-people"] });
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useRemoveMember(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (variables: { groupId: string; userId: string }) => {
      const response = await fetchWithAuth(
        `/group-members?group_id=${variables.groupId}&user_id=${variables.userId}`,
        { method: "DELETE" }
      );

      if (!response.ok && response.status !== 204) {
        throw new Error("Failed to remove member");
      }

      return variables;
    },
    onSuccess: (_data, variables) => {
      invalidateGroupAdjacents(queryClient, variables.groupId);
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}
