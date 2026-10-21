import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import {
  Appbar,
  Button,
  Icon,
  List,
  Modal as PaperModal,
  Portal,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { SplitAmongEditor } from "../components/SplitAmongEditor";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useAuth } from "../contexts/AuthContext";
import {
  BillSplitNetworkError,
  confirmBillSplit,
  createBillSplit,
  readBillSplit,
  useBillSplitPeople,
} from "../hooks/useBillSplit";
import { isBenignConnectivityError } from "../utils/networkErrors";
import { useProfile } from "../hooks/useProfile";
import type { Participant } from "../types";
import { allocateBillSplit, billAmountMinor, billSplitUrl, type BillSplitMode } from "../utils/billSplit";
import { CURRENCIES, formatCurrency, getCurrencyName, getDefaultCurrency, getLocaleCurrencyCode } from "../utils/currency";
import { existingPersonLabel, filterAndSortExistingPeople } from "../utils/peoplePicker";
import {
  formatRecentBillAmount,
  listRecentBillSplits,
  RECENT_BILLS_PREVIEW_COUNT,
  readLastBillSplitCurrency,
  relativeBillDate,
  rememberRecentBillSplit,
  settlementFromBillSession,
  updateRecentBillSettlement,
  writeLastBillSplitCurrency,
  type RecentBillSplit,
} from "../utils/recentBillSplits";
import { distributeRemaining, sanitizeAmountInput } from "../utils/splits";

const CREATOR = "bill-creator";
/** Match Paper List.Item title-only row height so loading does not shift the form. */
const KNOWN_PEOPLE_ROW_HEIGHT = 56;
const KNOWN_PEOPLE_SKELETON_ROWS = 3;
const CURRENCY_PICKER_LIMIT = 24;

export type SplitBillDraft = {
  amount?: string;
  currency?: string;
};

/**
 * Build a one-time-split draft from Add expense fields.
 * Always carries the currency the expense form is actually showing (not last-used split currency).
 */
export function splitDraftFromExpense(input: {
  amount: string;
  currency: string;
}): SplitBillDraft {
  const amount = input.amount.trim();
  const currency = input.currency.trim().toUpperCase();
  return {
    amount: amount || undefined,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
  };
}

function KnownPeopleSkeleton() {
  const theme = useTheme();
  return (
    <SkeletonGroup style={styles.knownPeople} testID="split-bill-people-skeleton">
      <View style={{ height: theme.fonts.labelLarge.lineHeight, justifyContent: "center" }}>
        <Skeleton width="40%" height={12} />
      </View>
      {Array.from({ length: KNOWN_PEOPLE_SKELETON_ROWS }, (_, index) => (
        <View key={index} style={[styles.knownPeopleRow, { height: KNOWN_PEOPLE_ROW_HEIGHT }]}>
          <Skeleton width="55%" height={14} />
          <Skeleton width={20} height={20} borderRadius={10} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

function BillDetailsSkeleton() {
  return (
    <SkeletonGroup style={{ gap: 16 }} testID="split-bill-details-skeleton" accessibilityLabel="Loading bill">
      <Skeleton width="28%" height={12} />
      <Skeleton width="48%" height={36} />
      <Skeleton width="90%" height={14} />
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.personSkeleton}>
          <Skeleton width="42%" height={18} />
          <Skeleton width="28%" height={16} />
          <Skeleton width="55%" height={40} borderRadius={8} />
        </View>
      ))}
      <Skeleton width="100%" height={44} borderRadius={22} />
      <Skeleton width="70%" height={14} />
    </SkeletonGroup>
  );
}

function formatSplitAmount(minor: number, currency: string): string {
  return formatCurrency(minor / 100, currency);
}

/** Native dead-link CTA; web keeps the #376 “Go to SharedMoney” label. */
export function billLinkGoHomeLabel(platform: string = Platform.OS): string {
  return platform === "web" ? "Go to SharedMoney" : "Go to Home";
}

/** Dead / expired one-time bill link — top-anchored, no Retry. */
export function BillLinkUnavailable({
  onGoHome,
}: {
  onGoHome: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.statusPanel} testID="bill-link-unavailable">
      <Text
        variant="headlineSmall"
        style={[styles.statusTitle, { color: theme.colors.onBackground }]}
      >
        This bill link isn’t working
      </Text>
      <Text
        variant="bodyLarge"
        style={{ color: theme.colors.onSurfaceVariant, lineHeight: 24 }}
      >
        It may have expired or been removed. Ask whoever sent it for a new link.
      </Text>
      <Button
        mode="contained"
        onPress={onGoHome}
        style={styles.statusPrimary}
        contentStyle={styles.statusPrimaryContent}
        testID="bill-link-go-home"
      >
        {billLinkGoHomeLabel()}
      </Button>
    </View>
  );
}

/**
 * Load failure for a bill link — Retry, not the dead-link copy.
 * When `offline` is true, use the locked “You’re offline” copy.
 */
export function BillLinkOffline({
  onRetry,
  offline = true,
}: {
  onRetry: () => void | Promise<unknown>;
  offline?: boolean;
}) {
  const theme = useTheme();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View
      style={styles.statusPanel}
      testID={offline ? "bill-link-offline" : "bill-link-load-error"}
    >
      <Text
        variant="headlineSmall"
        style={[styles.statusTitle, { color: theme.colors.onBackground }]}
      >
        {offline ? "You’re offline" : "Couldn’t load this bill"}
      </Text>
      <Text
        variant="bodyLarge"
        style={{ color: theme.colors.onSurfaceVariant, lineHeight: 24 }}
      >
        {offline
          ? "Check your connection and try again."
          : "Something went wrong loading this link. Try again."}
      </Text>
      <Button
        mode="contained"
        onPress={() => void handleRetry()}
        loading={retrying}
        disabled={retrying}
        style={styles.statusPrimary}
        contentStyle={styles.statusPrimaryContent}
        testID="bill-link-retry"
        accessibilityLabel={retrying ? "Retrying" : "Retry"}
      >
        Retry
      </Button>
    </View>
  );
}

function isBillSplitOfflineError(error: unknown): boolean {
  if (error instanceof BillSplitNetworkError) return true;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: string }).name === "BillSplitNetworkError"
  ) {
    return true;
  }
  return isBenignConnectivityError(error);
}

function RecentBillsBlock({
  bills,
  showAll,
  onShowAll,
  onOpen,
}: {
  bills: RecentBillSplit[];
  showAll: boolean;
  onShowAll: () => void;
  onOpen: (token: string) => void;
}) {
  const theme = useTheme();
  if (bills.length === 0) return null;
  const visible = showAll ? bills : bills.slice(0, RECENT_BILLS_PREVIEW_COUNT);
  return (
    <View style={styles.recentBills} testID="recent-bills-row">
      <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, fontWeight: "700" }}>
        Recent bills
      </Text>
      {visible.map((bill) => {
        const amount = formatRecentBillAmount(bill.amount_minor, bill.currency);
        const people = bill.people_count === 1 ? "1 person" : `${bill.people_count} people`;
        const when = relativeBillDate(bill.remembered_at);
        return (
          <Pressable
            key={bill.token}
            testID={`recent-bill-${bill.token.slice(0, 8)}`}
            onPress={() => onOpen(bill.token)}
            accessibilityRole="button"
            accessibilityLabel={`Open recent bill ${bill.identity}, ${amount}, ${people}${when ? `, ${when}` : ""}`}
            style={[styles.recentBillRow, { borderBottomColor: theme.colors.outlineVariant }]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyLarge" numberOfLines={1} style={{ fontWeight: "600" }}>
                {bill.identity}
              </Text>
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                {amount} · {people}{when ? ` · ${when}` : ""}
              </Text>
            </View>
            <Icon source="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        );
      })}
      {!showAll && bills.length > RECENT_BILLS_PREVIEW_COUNT ? (
        <Button mode="text" compact testID="recent-bills-see-all" onPress={onShowAll} style={{ alignSelf: "flex-start" }}>
          See all
        </Button>
      ) : null}
    </View>
  );
}

function BillSplitForm({
  onCreated,
  onOpenRecent,
  draft,
}: {
  onCreated: (token: string) => void;
  onOpenRecent: (token: string) => void;
  draft?: SplitBillDraft;
}) {
  const theme = useTheme();
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const directory = useBillSplitPeople();
  const [amount, setAmount] = useState(draft?.amount ?? "");
  const [currencyInput, setCurrency] = useState<string | undefined>(draft?.currency);
  const [currencyHydrated, setCurrencyHydrated] = useState(!!draft?.currency);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [recentBills, setRecentBills] = useState<RecentBillSplit[]>([]);
  const [showAllRecentBills, setShowAllRecentBills] = useState(false);
  const currency = currencyInput
    ?? profile?.preferred_currency
    ?? getLocaleCurrencyCode()
    ?? getDefaultCurrency();
  const [name, setName] = useState("");
  const [people, setPeople] = useState<Participant[]>([]);
  const [mode, setMode] = useState<BillSplitMode>("equal");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextPerson = useRef(0);
  const submitting = useRef(false);
  const participants: Participant[] = [
    { id: CREATOR, group_id: "", type: "member", full_name: profile?.full_name || "Bill creator" },
    ...people,
  ];
  const ids = participants.map((person) => person.id);
  const total = billAmountMinor(amount);
  const values = mode === "unequal" ? ids.map((id) => billAmountMinor(amounts[id] ?? "") ?? -1)
    : ids.map((id) => shares[id] ?? 1);
  let allocations: number[] = [];
  let validation = "";
  try {
    allocations = allocateBillSplit(total ?? 0, ids.length, mode, values);
    if (!/^[A-Z]{3}$/.test(currency)) validation = "Choose a currency.";
  } catch (err) {
    validation = (err as Error).message;
  }
  const suggestions = filterAndSortExistingPeople(directory.data ?? [], name)
    .filter((person) => !people.some((selected) => selected.id === person.id));
  const trimmedName = name.trim();
  const canAddByName = !!trimmedName && people.length < 49 && !busy;
  const createDisabled = busy || !!validation || total === null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (user?.id) {
        const rows = await listRecentBillSplits(user.id);
        if (!cancelled) setRecentBills(rows);
      }
      if (cancelled || currencyInput) {
        setCurrencyHydrated(true);
        return;
      }
      const last = await readLastBillSplitCurrency();
      if (cancelled) return;
      if (last) setCurrency(last);
      setCurrencyHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [currencyInput, user?.id]);

  const addPerson = (id: string, fullName: string) => {
    if (!fullName.trim() || people.length >= 49) return;
    setPeople((current) => [...current, { id, group_id: "", type: "member", full_name: fullName.trim().slice(0, 100) }]);
    setName("");
    setError(null);
  };
  const changeMode = (nextMode: BillSplitMode) => {
    if (nextMode === "unequal" && allocations.length && !ids.some((id) => amounts[id])) {
      setAmounts(Object.fromEntries(ids.map((id, i) => [id, (allocations[i] / 100).toFixed(2)])));
    }
    setMode(nextMode);
    setError(null);
  };
  const create = async () => {
    if (submitting.current || validation || total === null) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await createBillSplit({ amount: total, currency, mode, values, people: people.map((p) => p.full_name!) });
      if (user?.id) {
        await rememberRecentBillSplit(user.id, {
          token,
          amount_minor: total,
          currency,
          mode,
          people_count: people.length + 1,
          creatorName: profile?.full_name || "Bill creator",
          firstPayeeName: people[0]?.full_name,
          settled: false,
        });
      } else {
        await writeLastBillSplitCurrency(currency);
      }
      onCreated(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <>
    <RecentBillsBlock
      bills={recentBills}
      showAll={showAllRecentBills}
      onShowAll={() => setShowAllRecentBills(true)}
      onOpen={onOpenRecent}
    />
    <Text variant="bodyMedium">A one-time bill. No group needed.</Text>
    <TextInput
      label="Amount"
      mode="outlined"
      value={amount}
      keyboardType="decimal-pad"
      testID="split-bill-amount"
      disabled={busy}
      onChangeText={(text) => {
        const next = sanitizeAmountInput(text);
        if (next !== null) setAmount(next);
      }}
    />
    <View>
      <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
        Currency
      </Text>
      <Button
        mode="outlined"
        testID="split-bill-currency"
        disabled={busy || !currencyHydrated}
        onPress={() => setShowCurrencyPicker(true)}
        contentStyle={styles.currencyButtonContent}
        style={[styles.currencyButton, { borderRadius: 8 }]}
        labelStyle={{ color: theme.colors.onSurface }}
        icon={({ size }) => (
          <Icon source="chevron-down" size={size} color={theme.colors.onSurfaceVariant} />
        )}
      >
        {currency} ({CURRENCIES.find((item) => item.code === currency)?.symbol ?? currency})
      </Button>
    </View>
    <Text variant="titleMedium">Who’s on the bill?</Text>
    <Text variant="bodyMedium">You’re included. Add at least one other person.</Text>
    <TextInput
      label="Find someone or enter a new name"
      mode="outlined"
      value={name}
      testID="split-bill-person-input"
      maxLength={100}
      disabled={busy || people.length >= 49}
      onChangeText={setName}
    />
    {trimmedName ? (
      <Pressable
        testID="split-bill-add-person"
        disabled={!canAddByName}
        accessibilityRole="button"
        accessibilityLabel={`Add ${trimmedName}`}
        onPress={() => addPerson(`new:${nextPerson.current++}`, name)}
        style={({ pressed }) => [
          styles.addByNameRow,
          {
            opacity: canAddByName ? (pressed ? 0.7 : 1) : 0.45,
            borderBottomColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <Text variant="bodyLarge" style={{ color: theme.colors.primary, fontWeight: "600" }}>
          {`Add “${trimmedName.slice(0, 40)}”`}
        </Text>
        <Icon source="plus" size={20} color={theme.colors.primary} />
      </Pressable>
    ) : null}
    {directory.isLoading ? <KnownPeopleSkeleton /> : null}
    {directory.isError ? <><Text>Couldn’t load known people. You can still add by name.</Text>
      <Button onPress={() => void directory.refetch()}>Retry people</Button></> : null}
    {!directory.isLoading && suggestions.length > 0 && people.length < 49 ? <View style={styles.knownPeople} testID="split-bill-known-people">
      <Text variant="labelLarge">People you know</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: KNOWN_PEOPLE_ROW_HEIGHT * KNOWN_PEOPLE_SKELETON_ROWS }}>
        {suggestions.map((person) => (
          <Pressable
            key={person.id}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Add ${existingPersonLabel(person)}`}
            onPress={() => addPerson(person.id, existingPersonLabel(person))}
            style={({ pressed }) => [
              styles.knownPersonPressable,
              {
                minHeight: KNOWN_PEOPLE_ROW_HEIGHT,
                opacity: busy ? 0.45 : pressed ? 0.7 : 1,
                borderBottomColor: theme.colors.outlineVariant,
              },
            ]}
          >
            <Text variant="bodyLarge" style={{ flex: 1 }} numberOfLines={1}>
              {existingPersonLabel(person)}
            </Text>
            <List.Icon icon="plus" color={theme.colors.primary} />
          </Pressable>
        ))}
      </ScrollView>
    </View> : null}
    <SplitAmongEditor participants={participants} selectedIds={ids} amounts={amounts} shares={shares}
      mode={mode} totalAmount={total ? total / 100 : null} currency={currency} disabled={busy}
      requiredIds={[CREATOR]} modeTestID="split-bill-mode" showEqualSummary={false} areAllSelected
      onToggleAll={() => {}} onToggleMember={(id) => {
        if (id !== CREATOR) setPeople((current) => current.filter((p) => p.id !== id));
      }} onModeChange={changeMode}
      onAmountChange={(id, text) => setAmounts((current) => ({ ...current, [id]: text }))}
      onShareChange={(id, value) => setShares((current) => ({ ...current, [id]: value }))}
      onSplitRemaining={() => { if (total) setAmounts((current) => distributeRemaining(current, ids, total / 100)); }} />
    {mode === "equal" && allocations.length > 0 ? participants.map((person, i) =>
      <Text key={person.id}>{person.full_name}: {formatSplitAmount(allocations[i], currency)}</Text>) : null}
    {validation ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.onSurfaceVariant }}>{validation}</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.error }}>{error}</Text> : null}
    <Text variant="bodySmall">The link is available for 30 days. Anyone with it can see the names and amounts and acknowledge a share. SharedMoney does not move money.</Text>
    <Button
      mode="contained"
      testID="split-bill-create"
      disabled={createDisabled}
      onPress={() => void create()}
      buttonColor={theme.colors.primary}
      textColor={theme.colors.onPrimary}
      style={[styles.createCta, createDisabled && styles.createCtaDimmed]}
      contentStyle={styles.createCtaContent}
      theme={{
        colors: {
          surfaceDisabled: theme.colors.primary,
          onSurfaceDisabled: theme.colors.onPrimary,
        },
      }}
    >
      {/* "Creating…" only after tap / while submitting — not while people load. */}
      {busy ? "Creating…" : "Create & get share link"}
    </Button>
    <Portal>
      <PaperModal
        visible={showCurrencyPicker}
        onDismiss={() => setShowCurrencyPicker(false)}
        contentContainerStyle={[styles.currencyPickerModal, { backgroundColor: theme.colors.surface }]}
      >
        <Text variant="titleMedium" style={{ fontWeight: "700", marginBottom: 8 }}>
          Currency
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
          Used for this bill’s amounts.
        </Text>
        <ScrollView style={{ maxHeight: 360 }} testID="split-bill-currency-list">
          {CURRENCIES.slice(0, CURRENCY_PICKER_LIMIT).map((item) => {
            const selected = item.code === currency;
            return (
              <Pressable
                key={item.code}
                testID={`split-bill-currency-${item.code}`}
                onPress={() => {
                  setCurrency(item.code);
                  void writeLastBillSplitCurrency(item.code);
                  setShowCurrencyPicker(false);
                }}
                style={[
                  styles.currencyOption,
                  selected && { backgroundColor: theme.colors.primaryContainer },
                ]}
              >
                <View>
                  <Text variant="bodyLarge">{item.code} ({item.symbol})</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {getCurrencyName(item.code)}
                  </Text>
                </View>
                {selected ? <Icon source="check" size={20} color={theme.colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </PaperModal>
    </Portal>
  </>;
}

function BillSplitDetails({
  token,
  onGoHome,
  onStatusChrome,
}: {
  token: string;
  onGoHome: () => void;
  /** Tell the parent to use the “One-time bill” header on dead/offline states. */
  onStatusChrome?: (active: boolean) => void;
}) {
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ["bill-split-session", token];
  const [busy, setBusy] = useState(false);
  const session = useQuery({ queryKey: key, queryFn: () => readBillSplit(token), enabled: !busy, refetchInterval: busy ? false : 15_000, retry: false });
  const [message, setMessage] = useState("");
  const confirming = useRef(false);
  const url = billSplitUrl(token);
  const remembered = useRef(false);

  React.useEffect(() => {
    const showStatusChrome =
      session.isError || (!session.isPending && !session.data);
    onStatusChrome?.(showStatusChrome);
    return () => onStatusChrome?.(false);
  }, [session.isError, session.isPending, session.data, onStatusChrome]);

  React.useEffect(() => {
    if (!session.data || !user?.id) return;
    const settlement = settlementFromBillSession(session.data);
    if (!remembered.current) {
      remembered.current = true;
      void rememberRecentBillSplit(user.id, {
        token,
        amount_minor: session.data.amount_minor,
        currency: session.data.currency,
        mode: session.data.mode,
        people_count: session.data.participants.length,
        creatorName: session.data.participants[0]?.display_name,
        firstPayeeName: session.data.participants[1]?.display_name,
        settled: settlement.settled,
        your_net_minor: settlement.your_net_minor,
      });
      return;
    }
    void updateRecentBillSettlement(user.id, token, settlement);
  }, [session.data, token, user?.id]);

  const confirm = async (id: string) => {
    if (confirming.current) return;
    confirming.current = true;
    setBusy(true);
    setMessage("");
    try {
      // Cancel older reads so a stale poll cannot overwrite acknowledgement.
      await queryClient.cancelQueries({ queryKey: key });
      const result = await confirmBillSplit(token, id);
      queryClient.setQueryData(key, result);
      if (result && user?.id) {
        const settlement = settlementFromBillSession(result);
        void updateRecentBillSettlement(user.id, token, settlement);
      }
      if (result) setMessage("Your share is confirmed. No money has moved.");
    } catch (err) { setMessage((err as Error).message); }
    finally { confirming.current = false; setBusy(false); }
  };
  const share = async () => {
    try {
      if (Platform.OS === "web") {
        if (navigator.share) await navigator.share({ title: "Split a bill", text: "See and confirm your share on SharedMoney.", url });
        else if (navigator.clipboard) { await navigator.clipboard.writeText(url); setMessage("Link copied."); }
        else setMessage("Select and copy the link below.");
      } else await Share.share({ message: `See and confirm your share on SharedMoney: ${url}`, url });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setMessage("Couldn’t share. You can copy the link below.");
    }
  };

  if (session.isPending) return <BillDetailsSkeleton />;
  if (session.isError) {
    // Dead/expired tokens return null with no error. isError ⇒ load failure; use
    // offline copy when we can tell it's connectivity, otherwise still Retry.
    return (
      <BillLinkOffline
        onRetry={() => session.refetch()}
        offline={isBillSplitOfflineError(session.error)}
      />
    );
  }
  if (!session.data) return <BillLinkUnavailable onGoHome={onGoHome} />;
  const modeLabel = session.data.mode === "unequal"
    ? "Exact amounts"
    : session.data.mode === "shares"
      ? "Shares"
      : "Equal split";
  return <>
    <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>Total</Text>
    <Text variant="headlineLarge">{formatSplitAmount(session.data.amount_minor, session.data.currency)}</Text>
    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{modeLabel}</Text>
    <Text>Choose your name to confirm your share. This is an acknowledgement only; no money moves.</Text>
    {session.data.participants.map((person) => <Surface key={person.id} elevation={0}
      style={[styles.person, { backgroundColor: theme.colors.surfaceVariant }]}>
      <Text variant="titleMedium">{person.display_name}</Text>
      <Text variant="bodyLarge">{formatSplitAmount(person.amount_minor, session.data!.currency)}</Text>
      <Button testID="split-bill-confirm" mode={person.confirmed ? "text" : "outlined"}
        disabled={busy || person.confirmed} accessibilityLabel={person.confirmed ? `${person.display_name}, confirmed` : `Confirm my share as ${person.display_name}`}
        onPress={() => void confirm(person.id)}>{person.confirmed ? "Confirmed" : "I’ll cover my share"}</Button>
    </Surface>)}
    <Text accessibilityLiveRegion="polite">{message}</Text>
    <Button mode="contained" icon="share-variant" onPress={() => void share()}>Share link</Button>
    <Text selectable testID="split-bill-share-link" style={{ color: theme.colors.primary }}>{url}</Text>
    <Text variant="bodySmall">Anyone with this link can see and acknowledge a share. Keep the link to return to this bill; it expires after 30 days.</Text>
    <Button onPress={() => void session.refetch()} disabled={busy}>Refresh confirmations</Button>
  </>;
}

export function SplitBillScreen({
  token: initialToken,
  draft,
  onDismiss,
  /** __DEV__ screenshot helper — skips the network and paints locked empty states. */
  forceStatus,
  /**
   * `root` = app opened on this screen (cold-start deep link). Avoids a Modal
   * with an empty back stack; Back / Go to Home call onDismiss → Home/sign-in.
   * `modal` = opened over an existing in-app surface.
   */
  presentation = "modal",
}: {
  token?: string;
  draft?: SplitBillDraft;
  onDismiss: () => void;
  forceStatus?: "dead" | "offline";
  presentation?: "modal" | "root";
}) {
  const theme = useTheme();
  const [token, setToken] = useState(initialToken);
  const [statusChrome, setStatusChrome] = useState(Boolean(forceStatus));
  // Dead/offline screens use the singular “One-time bill” header (Design #387).
  const headerTitle =
    forceStatus || statusChrome ? "One-time bill" : "Split a bill";

  const body = (
    <Portal.Host>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
          <Appbar.BackAction
            onPress={onDismiss}
            accessibilityLabel="Go back"
            testID="split-bill-back"
          />
          <Appbar.Content title={headerTitle} testID="split-bill-header-title" />
        </Appbar.Header>
        <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {forceStatus === "dead" ? (
              <BillLinkUnavailable onGoHome={onDismiss} />
            ) : forceStatus === "offline" ? (
              <BillLinkOffline
                onRetry={async () => {
                  // Preview has nothing to refetch; keep spinner visible briefly.
                  await new Promise((resolve) => setTimeout(resolve, 400));
                }}
                offline
              />
            ) : token ? (
              <BillSplitDetails
                key={token}
                token={token}
                onGoHome={onDismiss}
                onStatusChrome={setStatusChrome}
              />
            ) : (
              <BillSplitForm
                draft={draft}
                onCreated={setToken}
                onOpenRecent={setToken}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Portal.Host>
  );

  if (presentation === "root") {
    return body;
  }

  // Portal.Host keeps Paper menus (Portal) in this modal layer so they paint above the sheet on web.
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onDismiss}
    >
      {body}
    </Modal>
  );
}

/** Design / Expo preview surfaces — mirrors create-form chrome without network. */
export function SplitBillFormPreview({
  loadingPeople = false,
  modeMenuOpen = false,
  disabledCreate = false,
  draft,
  showRecentBills = true,
}: {
  loadingPeople?: boolean;
  modeMenuOpen?: boolean;
  disabledCreate?: boolean;
  draft?: SplitBillDraft;
  showRecentBills?: boolean;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<BillSplitMode>("equal");
  const [menuOpen, setMenuOpen] = useState(modeMenuOpen);
  const amountValue = draft?.amount ?? "42.00";
  const currencyCode = draft?.currency ?? "USD";
  const currencySymbol = CURRENCIES.find((item) => item.code === currencyCode)?.symbol ?? currencyCode;
  const previewBills: RecentBillSplit[] = [
    {
      token: "a".repeat(64),
      amount_minor: 4200,
      currency: "USD",
      mode: "equal",
      identity: "Dinner at Nora",
      people_count: 3,
      remembered_at: new Date().toISOString(),
      settled: false,
      your_net_minor: 2800,
    },
    {
      token: "b".repeat(64),
      amount_minor: 12000,
      currency: "USD",
      mode: "equal",
      identity: "Cabin weekend",
      people_count: 4,
      remembered_at: new Date(Date.now() - 86_400_000).toISOString(),
      settled: false,
      your_net_minor: 9000,
    },
    {
      token: "c".repeat(64),
      amount_minor: 2850,
      currency: "EUR",
      mode: "equal",
      identity: "With Maya Patel",
      people_count: 2,
      remembered_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      settled: true,
      your_net_minor: 0,
    },
    {
      token: "d".repeat(64),
      amount_minor: 1800,
      currency: "USD",
      mode: "equal",
      identity: "Taxi home",
      people_count: 2,
      remembered_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      settled: false,
      your_net_minor: 900,
    },
  ];
  const participants: Participant[] = [
    { id: CREATOR, group_id: "", type: "member", full_name: "Alex" },
    { id: "p-maya", group_id: "", type: "member", full_name: "Maya Patel" },
  ];
  const ids = participants.map((p) => p.id);
  React.useEffect(() => {
    setMenuOpen(modeMenuOpen);
  }, [modeMenuOpen]);
  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]} testID="split-bill-form-preview">
      <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
        <Appbar.BackAction onPress={() => {}} />
        <Appbar.Content title="Split a bill" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {showRecentBills ? (
          <RecentBillsBlock
            bills={previewBills}
            showAll={false}
            onShowAll={() => {}}
            onOpen={() => {}}
          />
        ) : null}
        <Text variant="bodyMedium">A one-time bill. No group needed.</Text>
        <TextInput label="Amount" mode="outlined" value={amountValue} testID="split-bill-amount" />
        <View>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
            Currency
          </Text>
          <Button
            mode="outlined"
            testID="split-bill-currency"
            contentStyle={styles.currencyButtonContent}
            style={[styles.currencyButton, { borderRadius: 8 }]}
            labelStyle={{ color: theme.colors.onSurface }}
            icon={({ size }) => (
              <Icon source="chevron-down" size={size} color={theme.colors.onSurfaceVariant} />
            )}
          >
            {currencyCode} ({currencySymbol})
          </Button>
        </View>
        <Text variant="titleMedium">Who’s on the bill?</Text>
        <TextInput label="Find someone or enter a new name" mode="outlined" value="Sam" testID="split-bill-person-input" />
        <Pressable
          testID="split-bill-add-person"
          style={[styles.addByNameRow, { borderBottomColor: theme.colors.outlineVariant }]}
        >
          <Text variant="bodyLarge" style={{ color: theme.colors.primary, fontWeight: "600" }}>
            {`Add “Sam”`}
          </Text>
          <Icon source="plus" size={20} color={theme.colors.primary} />
        </Pressable>
        {loadingPeople ? <KnownPeopleSkeleton /> : (
          <View style={styles.knownPeople} testID="split-bill-known-people">
            <Text variant="labelLarge">People you know</Text>
            <Pressable
              style={[styles.knownPersonPressable, { minHeight: KNOWN_PEOPLE_ROW_HEIGHT, borderBottomColor: theme.colors.outlineVariant }]}
            >
              <Text variant="bodyLarge" style={{ flex: 1 }}>Maya Patel</Text>
              <List.Icon icon="plus" color={theme.colors.primary} />
            </Pressable>
          </View>
        )}
        <SplitAmongEditor
          participants={participants}
          selectedIds={ids}
          amounts={{}}
          shares={{}}
          mode={mode}
          totalAmount={Number.parseFloat(amountValue) || 42}
          currency={currencyCode}
          requiredIds={[CREATOR]}
          modeTestID="split-bill-mode"
          showEqualSummary={false}
          areAllSelected
          onToggleAll={() => {}}
          onToggleMember={() => {}}
          onModeChange={setMode}
          onAmountChange={() => {}}
          onShareChange={() => {}}
          onSplitRemaining={() => {}}
        />
        {menuOpen ? (
          <View testID="split-mode-menu-preview" style={[styles.modeMenuPreview, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
            {(["Equal", "Amounts", "Shares"] as const).map((label) => (
              <Text key={label} variant="bodyLarge" style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
                {label}{label === "Equal" ? "  ✓" : ""}
              </Text>
            ))}
          </View>
        ) : null}
        <Button
          mode="contained"
          testID="split-bill-create"
          disabled={disabledCreate || loadingPeople}
          buttonColor={theme.colors.primary}
          textColor={theme.colors.onPrimary}
          style={[styles.createCta, (disabledCreate || loadingPeople) && styles.createCtaDimmed]}
          contentStyle={styles.createCtaContent}
          theme={{
            colors: {
              surfaceDisabled: theme.colors.primary,
              onSurfaceDisabled: theme.colors.onPrimary,
            },
          }}
        >
          Create & get share link
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16, width: "100%", maxWidth: WEB_MAX_WIDTH, alignSelf: "center" },
  statusPanel: {
    gap: 12,
    paddingTop: 8,
    alignItems: "stretch",
  },
  statusTitle: {
    fontWeight: "700",
  },
  statusPrimary: {
    marginTop: 12,
    alignSelf: "stretch",
    borderRadius: 24,
  },
  statusPrimaryContent: {
    height: 48,
  },
  recentBills: { gap: 4, marginBottom: 4 },
  recentBillRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  person: { padding: 16, borderRadius: 12, gap: 8 },
  personSkeleton: { padding: 16, borderRadius: 12, gap: 8 },
  knownPeople: { gap: 4 },
  knownPeopleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  knownPersonPressable: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addByNameRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  currencyButton: {
    alignSelf: "stretch",
  },
  currencyButtonContent: {
    minHeight: 48,
    justifyContent: "space-between",
    flexDirection: "row-reverse",
  },
  currencyPickerModal: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  currencyOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  createCta: {
    borderRadius: 24,
    borderWidth: 0,
    alignSelf: "stretch",
  },
  createCtaDimmed: {
    opacity: 0.45,
  },
  createCtaContent: {
    minHeight: 48,
    borderRadius: 24,
  },
  modeMenuPreview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
