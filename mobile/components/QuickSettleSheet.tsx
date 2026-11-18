import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { ActivityIndicator, Text, useTheme } from "react-native-paper";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { queryKeys } from "../hooks/queryKeys";
import { useProfile } from "../hooks/useProfile";
import { usePeopleSettlements } from "../hooks/usePeopleSettlements";
import { useCreateSettlement, useCreateSettlements, useDeleteSettlement } from "../hooks/useSettlements";
import { useCreateTransaction, useDeleteTransaction } from "../hooks/useTransactions";
import { createOrGetDirectGroup } from "../utils/directGroup";
import { filterCurrencies } from "../utils/isoCurrencies";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import {
  personSettlePlan,
  settlementCreateFromLine,
  type PersonSettlement,
} from "../utils/peopleSettlements";
import {
  groupDebtOffer,
  isFutureLocalDate,
  isGuestAccount,
  localIsoDate,
  personListLabel,
  quickSettleParties,
  quickSettlePickerPeople,
  quickSettleSharePayload,
  quickSettleSuccessCopy,
  resolveQuickSettleCurrency,
  type QuickSettleDirection,
  type QuickSettleMode,
} from "../utils/quickSettle";
import { shareSettleDraft } from "../utils/shareSettleDraft";
import {
  formatShareCurrency,
  parseShareAmountInput,
  settleFirstName,
} from "../utils/settleShareMessage";

export type QuickSettleSource = "home_header" | "home_empty";
export type QuickSettlePreview =
  | "people"
  | "offer"
  | "form"
  | "success"
  | "guest";

type SavedRecord =
  | { kind: "settlement"; id: string; groupId: string }
  | { kind: "transaction"; id: number; groupId: string }
  | { kind: "batch"; rows: { id: string; groupId: string }[] };

type ChosenPerson = {
  name: string;
  userId: string | null;
  email: string | null;
  phone: string | null;
  isNew: boolean;
  person: PersonSettlement | null;
};

const NOTE_LIMIT = 200;

const PREVIEW_PEOPLE: PersonSettlement[] = [
  {
    key: "dev",
    displayName: "Dev",
    email: null,
    avatarUrl: null,
    userId: "dev",
    netsByCurrency: { INR: 2860 },
    lines: [{
      groupId: "office",
      groupName: "Office lunch",
      kind: "standard",
      amount: 2860,
      currency: "INR",
      direction: "receive",
      signedAmount: 2860,
      you: { user_id: "me", amount: 2860, currency: "INR" },
      other: { user_id: "dev", amount: -2860, currency: "INR", full_name: "Dev" },
      originalParts: [],
    }],
  },
  {
    key: "rahul",
    displayName: "Rahul",
    email: null,
    avatarUrl: null,
    userId: "rahul",
    netsByCurrency: { INR: 1250 },
    lines: [
      {
        groupId: "goa",
        groupName: "Goa trip",
        kind: "standard",
        amount: 1600,
        currency: "INR",
        direction: "receive",
        signedAmount: 1600,
        you: { user_id: "me", amount: 1600, currency: "INR" },
        other: { user_id: "rahul", amount: -1600, currency: "INR", full_name: "Rahul" },
        originalParts: [],
      },
      {
        groupId: "flat",
        groupName: "Flat 4B",
        kind: "standard",
        amount: 350,
        currency: "INR",
        direction: "pay",
        signedAmount: -350,
        you: { user_id: "me", amount: -350, currency: "INR" },
        other: { user_id: "rahul", amount: 350, currency: "INR", full_name: "Rahul" },
        originalParts: [],
      },
    ],
  },
  {
    key: "meera",
    displayName: "Meera",
    email: null,
    avatarUrl: null,
    userId: "meera",
    netsByCurrency: { INR: 800 },
    lines: [{
      groupId: "goa",
      groupName: "Goa trip",
      kind: "standard",
      amount: 800,
      currency: "INR",
      direction: "receive",
      signedAmount: 800,
      you: { user_id: "me", amount: 800, currency: "INR" },
      other: { user_id: "meera", amount: -800, currency: "INR", full_name: "Meera" },
      originalParts: [],
    }],
  },
  {
    key: "aisha",
    displayName: "Aisha",
    email: null,
    avatarUrl: null,
    userId: "aisha",
    netsByCurrency: { INR: -700 },
    lines: [{
      groupId: "flat",
      groupName: "Flat 4B",
      kind: "standard",
      amount: 700,
      currency: "INR",
      direction: "pay",
      signedAmount: -700,
      you: { user_id: "me", amount: -700, currency: "INR" },
      other: { user_id: "aisha", amount: 700, currency: "INR", full_name: "Aisha" },
      originalParts: [],
    }],
  },
];

function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[x]/g, () => (
    Math.floor(Math.random() * 16).toString(16)
  ));
}

function settlementFromResponse(value: unknown): { id: string; group_id?: string } | null {
  if (!value || typeof value !== "object" || !("settlement" in value)) return null;
  const settlement = (value as { settlement?: { id?: unknown; group_id?: unknown } }).settlement;
  if (!settlement || typeof settlement.id !== "string") return null;
  return {
    id: settlement.id,
    group_id: typeof settlement.group_id === "string" ? settlement.group_id : undefined,
  };
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

function dateLabel(iso: string, today: string): string {
  return iso === today ? "Today" : iso;
}

interface QuickSettleSheetProps {
  visible: boolean;
  source: QuickSettleSource;
  onDismiss: () => void;
  onViewGroup?: (groupId: string) => void;
  /** Seam for #524. Email and WhatsApp continue there; Google and Apple use the current session. */
  onContinueSignIn?: (method: "email" | "whatsapp") => void;
  preview?: QuickSettlePreview;
}

export const QuickSettleSheet: React.FC<QuickSettleSheetProps> = ({
  visible,
  source,
  onDismiss,
  onViewGroup,
  onContinueSignIn,
  preview,
}) => {
  const theme = useTheme();
  const { user, signInWithGoogle, signInWithApple } = useAuth();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const peopleQuery = usePeopleSettlements({ enabled: visible && !preview });
  const createSettlement = useCreateSettlement();
  const createSettlements = useCreateSettlements();
  const deleteSettlement = useDeleteSettlement();
  const createTransaction = useCreateTransaction();
  const deleteTransaction = useDeleteTransaction();

  const [step, setStep] = useState<"people" | "name" | "offer" | "form" | "success" | "guest">(
    preview === "offer" ? "offer"
      : preview === "form" ? "form"
        : preview === "success" ? "success"
          : preview === "guest" ? "guest"
            : "people",
  );
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ChosenPerson | null>(preview ? {
    name: preview === "offer" ? "Rahul" : "Kabir",
    userId: null,
    email: null,
    phone: null,
    isNew: preview !== "offer",
    person: preview === "offer" ? PREVIEW_PEOPLE[1] : null,
  } : null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [mode, setMode] = useState<QuickSettleMode>("payment");
  const [direction, setDirection] = useState<QuickSettleDirection | null>(preview === "form" || preview === "success" ? "you_paid" : null);
  const [amountText, setAmountText] = useState(preview === "form" || preview === "success" ? "500" : "");
  const [note, setNote] = useState(preview === "form" || preview === "success" ? "Movie tickets" : "");
  const [date, setDate] = useState(localIsoDate());
  const [showDate, setShowDate] = useState(false);
  const [currency, setCurrency] = useState<string | null>(preview ? "INR" : null);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRecord | null>(null);
  const [savedGroupId, setSavedGroupId] = useState<string | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(preview === "success" ? 10 : 0);
  const [success, setSuccess] = useState(preview === "success" || preview === "guest"
    ? { title: "You paid Kabir ₹500", body: "Kabir owes you ₹500" }
    : null);
  const requestKey = useRef<string | null>(null);
  const opened = useRef(false);

  const people = preview === "people" ? PREVIEW_PEOPLE : peopleQuery.people;
  const listed = useMemo(() => quickSettlePickerPeople(people, query), [people, query]);
  const guest = isGuestAccount(user);
  const today = localIsoDate();
  const displayName = chosen?.name || "them";
  const first = settleFirstName(displayName);
  const amount = parseShareAmountInput(amountText);
  const offer = chosen?.person ? groupDebtOffer(chosen.person) : null;

  useEffect(() => {
    if (!visible) {
      opened.current = false;
      return;
    }
    if (opened.current || preview) return;
    opened.current = true;
    captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.QUICK_SETTLE_OPENED, {
      source,
      is_guest: guest,
    });
  }, [visible, preview, source, user?.id, guest]);

  useEffect(() => {
    if (undoSeconds <= 0 || preview) return;
    const timer = setTimeout(() => setUndoSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [undoSeconds, preview]);

  const resetForm = () => {
    setMode("payment");
    setDirection(null);
    setAmountText("");
    setNote("");
    setDate(localIsoDate());
    setError(null);
    requestKey.current = null;
  };

  const close = () => {
    if (saving) return;
    setStep("people");
    setQuery("");
    setChosen(null);
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setSaved(null);
    setSuccess(null);
    setUndoSeconds(0);
    resetForm();
    onDismiss();
  };

  const chooseExisting = (person: PersonSettlement) => {
    const next: ChosenPerson = {
      name: person.displayName,
      userId: person.userId,
      email: person.email,
      phone: null,
      isNew: false,
      person,
    };
    setChosen(next);
    const resolved = resolveQuickSettleCurrency({
      preferredCurrency: profile.data?.preferred_currency,
      currenciesWithPerson: Object.keys(person.netsByCurrency),
    });
    setCurrency(resolved.currency);
    const debts = groupDebtOffer(person);
    if (debts) {
      setStep("offer");
      return;
    }
    resetForm();
    setCurrency(resolved.currency);
    setStep("form");
  };

  const continueNewPerson = () => {
    const name = newName.trim().replace(/\s+/g, " ");
    if (name.length < 1) {
      setError("Enter a name");
      return;
    }
    if (name.length > 80) {
      setError("Name is too long");
      return;
    }
    const email = newEmail.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email like name@example.com.");
      return;
    }
    const phone = newPhone.trim();
    if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError("Enter a phone in international format, like +9198…");
      return;
    }
    setError(null);
    setChosen({
      name,
      userId: null,
      email: email || null,
      phone: phone || null,
      isNew: true,
      person: null,
    });
    const resolved = resolveQuickSettleCurrency({
      preferredCurrency: profile.data?.preferred_currency,
      currenciesWithPerson: [],
    });
    resetForm();
    setCurrency(resolved.currency);
    setStep("form");
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
      queryClient.invalidateQueries({ queryKey: ["balances"] }),
    ]);
  };

  const record = async () => {
    if (!chosen || !direction || amount == null || amount <= 0 || !currency) return;
    if (isFutureLocalDate(date)) {
      setError("Date must be today or earlier");
      return;
    }
    if (note.trim().length > NOTE_LIMIT) {
      setError("Note is too long");
      return;
    }
    if (!requestKey.current) requestKey.current = newRequestId();
    setSaving(true);
    setError(null);
    try {
      const ledger = await createOrGetDirectGroup({
        counterpartyUserId: chosen.userId,
        name: chosen.name,
        email: chosen.email,
        phone: chosen.phone,
      });
      const parties = quickSettleParties({
        direction,
        youParticipantId: ledger.viewerParticipantId,
        themParticipantId: ledger.counterpartyParticipantId,
      });
      const previous = chosen.person?.lines.find((line) => (
        line.kind === "direct" && line.currency.toUpperCase() === currency
      ))?.signedAmount ?? 0;
      const trimmedNote = note.trim();
      if (mode === "payment") {
        const created = await createSettlement.mutate({
          group_id: ledger.groupId,
          from_participant_id: parties.payerParticipantId,
          to_participant_id: parties.debtorParticipantId,
          amount,
          currency,
          notes: trimmedNote || undefined,
          date,
          client_request_id: requestKey.current,
          analytics: { group_kind: "direct" },
        });
        const settlement = settlementFromResponse(created);
        if (!settlement) throw new Error("Could not record that payment");
        setSaved({ kind: "settlement", id: settlement.id, groupId: ledger.groupId });
      } else {
        const created = await createTransaction.mutate({
          group_id: ledger.groupId,
          amount,
          description: trimmedNote || "Recorded debt",
          date,
          type: "expense",
          currency,
          paid_by_participant_id: parties.payerParticipantId,
          split_among_participant_ids: [parties.debtorParticipantId],
          splits: [{ participant_id: parties.debtorParticipantId, amount }],
          client_request_id: requestKey.current,
          analytics: { group_kind: "direct", source: "quick_settle" },
        });
        if (!created?.id) throw new Error("Could not record that debt");
        setSaved({ kind: "transaction", id: created.id, groupId: ledger.groupId });
      }
      const copy = quickSettleSuccessCopy({
        name: chosen.name,
        direction,
        amount,
        currency,
        previousDirectBalance: previous,
      });
      setSuccess(copy);
      setSavedGroupId(ledger.groupId);
      setUndoSeconds(10);
      setStep("success");
      captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.QUICK_SETTLE_RECORDED, {
        direction,
        person: chosen.isNew ? "new" : "existing",
        currency_prefilled: resolveQuickSettleCurrency({
          preferredCurrency: profile.data?.preferred_currency,
          currenciesWithPerson: chosen.person ? Object.keys(chosen.person.netsByCurrency) : [],
        }).prefilled,
        is_guest: guest,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that");
    } finally {
      setSaving(false);
    }
  };

  const settleOffer = async () => {
    if (!chosen?.person || !offer) return;
    captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.QUICK_SETTLE_GROUP_DEBTS_OFFERED, {
      accepted: true,
    });
    const plan = personSettlePlan(
      { ...chosen.person, lines: offer.lines },
      `Settled with ${chosen.name}`,
    );
    if (!plan.canSettleAll) {
      setError("Some of these balances need a currency before they can be settled");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const results = await createSettlements.mutate(plan.recordable);
      const rows = results.flatMap((result) => {
        const settlement = settlementFromResponse(result);
        return settlement?.group_id
          ? [{ id: settlement.id, groupId: settlement.group_id }]
          : [];
      });
      setSaved({ kind: "batch", rows });
      const money = offer.canSum && offer.currency
        ? formatShareCurrency(Math.abs(offer.net), offer.currency)
        : "";
      setSuccess({
        title: money ? `Settled ${money} with ${chosen.name}` : `Settled with ${chosen.name}`,
        body: offer.headline,
      });
      setUndoSeconds(10);
      setStep("success");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not settle those groups");
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!saved || undoSeconds <= 0) return;
    setSaving(true);
    try {
      if (saved.kind === "settlement") {
        await deleteSettlement.mutate({ id: saved.id, groupId: saved.groupId });
      } else if (saved.kind === "transaction") {
        await deleteTransaction.mutate({ id: saved.id, group_id: saved.groupId });
      } else {
        for (const row of saved.rows) {
          await deleteSettlement.mutate({ id: row.id, groupId: row.groupId });
        }
      }
      captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.QUICK_SETTLE_UNDONE, {
        is_guest: guest,
      });
      await refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo that");
    } finally {
      setSaving(false);
    }
  };

  const shareText = async () => {
    if (!success || !chosen) return;
    const shareAmount = amount ?? (offer ? Math.abs(offer.net) : null);
    const shareCurrency = currency ?? offer?.currency ?? null;
    if (shareAmount == null || shareAmount <= 0 || !shareCurrency) return;
    const theyOweYou = direction
      ? direction === "you_paid" || direction === "they_owe"
      : (offer?.net ?? 0) >= 0;
    const payload = quickSettleSharePayload({
      counterpartyName: chosen.name,
      theyOweYou,
      amount: shareAmount,
      currency: shareCurrency,
      note,
    });
    if (payload.kind !== "text") return;
    await shareSettleDraft(payload.message);
    captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.QUICK_SETTLE_LINK_SHARED, {
      channel: "system_share",
      kind: "text",
    });
  };

  const sendLink = () => {
    if (guest) {
      setStep("guest");
      return;
    }
    void shareText();
  };

  const paymentLabels: [QuickSettleDirection, string][] = mode === "payment"
    ? [["you_paid", `You paid ${first}`], ["they_paid", `${first} paid you`]]
    : [["they_owe", `${first} owes you`], ["you_owe", `You owe ${first}`]];

  const canRecord = !!direction && amount != null && amount > 0 && !!currency && !isFutureLocalDate(date) && !saving;
  const recordLabel = amount != null && amount > 0 && currency
    ? `Record ${formatShareCurrency(amount, currency)}`
    : "Record";

  const surface = theme.colors.surface;
  const ink = theme.colors.onSurface;
  const muted = theme.colors.onSurfaceVariant;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimTap} onPress={close} accessibilityLabel="Close settle" />
        <View style={[styles.sheet, { backgroundColor: surface }]}>
          <View style={[styles.handle, { backgroundColor: theme.colors.outline }]} />
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {step === "people" ? (
              <View>
                <Text style={[styles.title, { color: ink }]}>Settle up with</Text>
                <View style={[styles.search, { backgroundColor: theme.colors.surfaceVariant }]}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search people"
                    placeholderTextColor={muted}
                    style={[styles.searchInput, { color: ink }]}
                    autoCorrect={false}
                    testID="quick-settle-search"
                  />
                </View>
                {peopleQuery.isLoading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
                {listed.map((person) => {
                  const nets = Object.entries(person.netsByCurrency).filter(([, value]) => Math.abs(value) >= 0.01);
                  const single = nets.length === 1 ? nets[0] : null;
                  const owed = !!single && single[1] > 0;
                  return (
                    <Pressable
                      key={person.key}
                      style={[styles.person, { borderBottomColor: theme.colors.outlineVariant }]}
                      onPress={() => chooseExisting(person)}
                      testID={`quick-settle-person-${person.key}`}
                    >
                      <View style={[styles.avatar, { backgroundColor: theme.colors.primaryContainer }]}>
                        <Text style={{ color: theme.colors.onPrimaryContainer, fontWeight: "700" }}>{initials(person.displayName)}</Text>
                      </View>
                      <View style={styles.personText}>
                        <Text style={[styles.personName, { color: ink }]}>{person.displayName}</Text>
                        <Text style={{ color: muted, fontSize: 13 }}>{personListLabel(person)}</Text>
                      </View>
                      <View style={styles.personAmount}>
                        <Text style={{
                          fontWeight: "700",
                          color: single ? (owed ? theme.colors.tertiary : theme.colors.error) : muted,
                        }}>
                          {single ? formatShareCurrency(Math.abs(single[1]), single[0]) : "Mixed"}
                        </Text>
                        <Text style={{ color: muted, fontSize: 12 }}>
                          {single ? (owed ? "owes you" : "you owe") : "open both ways"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={styles.addRow}
                  onPress={() => {
                    setError(null);
                    setStep("name");
                  }}
                  testID="quick-settle-new-person"
                >
                  <View style={[styles.avatar, styles.avatarAdd, { borderColor: theme.colors.outline }]}>
                    <Text style={{ color: theme.colors.primary, fontSize: 20 }}>+</Text>
                  </View>
                  <Text style={{ color: theme.colors.primary, fontWeight: "600", fontSize: 16 }}>New person</Text>
                </Pressable>
              </View>
            ) : null}

            {step === "name" ? (
              <View>
                <Pressable onPress={() => setStep("people")} accessibilityLabel="Back">
                  <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>Back</Text>
                </Pressable>
                <Text style={[styles.title, { color: ink, marginTop: 12 }]}>New person</Text>
                <Text style={[styles.label, { color: muted }]}>Name</Text>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Their name"
                  placeholderTextColor={muted}
                  style={[styles.field, { color: ink, borderColor: theme.colors.outline }]}
                  testID="quick-settle-new-name"
                />
                <Text style={[styles.label, { color: muted }]}>Email, if you have it</Text>
                <TextInput
                  value={newEmail}
                  onChangeText={setNewEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="Optional"
                  placeholderTextColor={muted}
                  style={[styles.field, { color: ink, borderColor: theme.colors.outline }]}
                />
                <Text style={[styles.label, { color: muted }]}>Phone, if you have it</Text>
                <TextInput
                  value={newPhone}
                  onChangeText={setNewPhone}
                  keyboardType="phone-pad"
                  placeholder="+91…"
                  placeholderTextColor={muted}
                  style={[styles.field, { color: ink, borderColor: theme.colors.outline }]}
                />
                {error ? <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{error}</Text> : null}
                <Pressable style={[styles.filled, { backgroundColor: theme.colors.primary }]} onPress={continueNewPerson}>
                  <Text style={{ color: theme.colors.onPrimary, fontWeight: "600" }}>Continue</Text>
                </Pressable>
              </View>
            ) : null}

            {step === "offer" && (offer || preview) ? (
              <View>
                <View style={styles.head}>
                  <Pressable onPress={() => setStep("people")} accessibilityLabel="Back">
                    <Text style={{ color: ink, fontSize: 20 }}>←</Text>
                  </Pressable>
                  <View style={[styles.avatar, { backgroundColor: theme.colors.secondaryContainer }]}>
                    <Text style={{ fontWeight: "700", color: theme.colors.onSecondaryContainer }}>{initials(displayName)}</Text>
                  </View>
                  <Text style={[styles.personName, { color: ink }]}>{displayName}</Text>
                </View>
                <View style={[styles.offer, { borderColor: theme.colors.outlineVariant }]}>
                  <Text style={[styles.offerTitle, { color: ink }]}>
                    {offer?.headline || "Rahul owes you ₹1,250 across 2 groups"}
                  </Text>
                  {(offer?.lines || [
                    { groupName: "Goa trip", signedAmount: 1600, currency: "INR", groupId: "goa" },
                    { groupName: "Flat 4B", signedAmount: -350, currency: "INR", groupId: "flat" },
                  ]).map((line) => (
                    <View key={`${line.groupId}-${line.signedAmount}`} style={[styles.offerLine, { borderTopColor: theme.colors.outlineVariant }]}>
                      <Text style={{ color: ink }}>{line.groupName}</Text>
                      <Text style={{ fontWeight: "700", color: line.signedAmount < 0 ? theme.colors.error : theme.colors.tertiary }}>
                        {line.signedAmount < 0 ? "−" : "+"}
                        {formatShareCurrency(Math.abs(line.signedAmount), line.currency)}
                      </Text>
                    </View>
                  ))}
                </View>
                {error ? <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{error}</Text> : null}
                <Pressable
                  style={[styles.filled, { backgroundColor: theme.colors.primary }]}
                  onPress={() => void settleOffer()}
                  disabled={saving || !!preview}
                  testID="quick-settle-these"
                >
                  <Text style={{ color: theme.colors.onPrimary, fontWeight: "600" }}>
                    {offer?.canSum && offer.currency
                      ? `Settle these ${formatShareCurrency(Math.abs(offer.net), offer.currency)}`
                      : "Settle these ₹1,250"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.QUICK_SETTLE_GROUP_DEBTS_OFFERED, {
                      accepted: false,
                    });
                    resetForm();
                    setStep("form");
                  }}
                  testID="quick-settle-just-record"
                >
                  <Text style={[styles.ghost, { color: theme.colors.primary }]}>Just record a payment</Text>
                </Pressable>
              </View>
            ) : null}

            {step === "form" ? (
              <View>
                <View style={styles.head}>
                  <Pressable onPress={() => setStep(chosen?.person && offer ? "offer" : "people")} accessibilityLabel="Back">
                    <Text style={{ color: ink, fontSize: 20 }}>←</Text>
                  </Pressable>
                  <View style={[styles.avatar, { backgroundColor: theme.colors.primaryContainer }]}>
                    <Text style={{ fontWeight: "700", color: theme.colors.onPrimaryContainer }}>{initials(displayName)}</Text>
                  </View>
                  <Text style={[styles.personName, { color: ink }]}>{displayName}</Text>
                  {chosen?.isNew ? (
                    <Text style={[styles.tag, { backgroundColor: theme.colors.surfaceVariant, color: muted }]}>New</Text>
                  ) : null}
                </View>
                <View style={[styles.segment, { borderColor: theme.colors.outline }]}>
                  {paymentLabels.map(([value, label], index) => {
                    const on = direction === value;
                    return (
                      <Pressable
                        key={value}
                        style={[
                          styles.segmentItem,
                          index > 0 && { borderLeftColor: theme.colors.outline, borderLeftWidth: 1 },
                          on && { backgroundColor: theme.colors.primaryContainer },
                        ]}
                        onPress={() => setDirection(value)}
                        testID={`quick-settle-direction-${value}`}
                      >
                        <Text style={{
                          fontWeight: "600",
                          fontSize: 14,
                          color: on ? theme.colors.onPrimaryContainer : ink,
                          textAlign: "center",
                        }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={[styles.amountRow, { borderBottomColor: theme.colors.primary }]}>
                  <Pressable
                    style={[styles.currency, { backgroundColor: theme.colors.surfaceVariant }]}
                    onPress={() => setCurrencyOpen(true)}
                    testID="quick-settle-currency"
                  >
                    <Text style={{ fontWeight: "700", color: muted }}>{currency || "Currency"}</Text>
                  </Pressable>
                  <Text style={[styles.bigAmount, { color: ink }]}>
                    {currency ? formatShareCurrency(0, currency).replace(/[0-9.,\s]/g, "") : ""}
                  </Text>
                  <TextInput
                    value={amountText}
                    onChangeText={setAmountText}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={muted}
                    style={[styles.bigAmount, styles.amountInput, { color: ink }]}
                    testID="quick-settle-amount"
                  />
                </View>
                <Text style={[styles.label, { color: muted }]}>Note</Text>
                <TextInput
                  value={note}
                  onChangeText={(value) => setNote(value.slice(0, NOTE_LIMIT))}
                  placeholder="Optional"
                  placeholderTextColor={muted}
                  style={[styles.field, { color: ink, borderColor: theme.colors.outline }]}
                  testID="quick-settle-note"
                />
                <View style={styles.dateRow}>
                  <Text style={{ color: ink, fontSize: 15 }}>Date</Text>
                  <Pressable
                    style={[styles.dateChip, { borderColor: theme.colors.outlineVariant }]}
                    onPress={() => setShowDate(true)}
                    testID="quick-settle-date"
                  >
                    <Text style={{ fontWeight: "600", color: ink }}>{dateLabel(date, today)}</Text>
                  </Pressable>
                </View>
                {showDate && Platform.OS !== "web" ? (
                  <DateTimePicker
                    value={new Date(`${date}T12:00:00`)}
                    mode="date"
                    maximumDate={new Date()}
                    onChange={(_event, selected) => {
                      setShowDate(false);
                      if (!selected) return;
                      const iso = localIsoDate(selected);
                      if (!isFutureLocalDate(iso)) setDate(iso);
                    }}
                  />
                ) : null}
                {showDate && Platform.OS === "web" ? (
                  <TextInput
                    value={date}
                    onChangeText={(value) => {
                      setDate(value);
                      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !isFutureLocalDate(value)) setShowDate(false);
                    }}
                    style={[styles.field, { color: ink, borderColor: theme.colors.outline }]}
                  />
                ) : null}
                {!currency ? (
                  <Text style={{ color: muted, marginBottom: 8 }}>Choose a currency. Nothing is assumed.</Text>
                ) : null}
                {error ? <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{error}</Text> : null}
                <Pressable
                  style={[styles.filled, { backgroundColor: canRecord ? theme.colors.primary : theme.colors.surfaceVariant }]}
                  disabled={!canRecord}
                  onPress={() => void record()}
                  testID="quick-settle-record"
                >
                  <Text style={{ color: canRecord ? theme.colors.onPrimary : muted, fontWeight: "600" }}>
                    {saving ? "Recording…" : recordLabel}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMode(mode === "payment" ? "debt" : "payment");
                    setDirection(null);
                  }}
                  testID="quick-settle-debt-link"
                >
                  <Text style={[styles.ghost, { color: theme.colors.primary }]}>
                    {mode === "payment" ? "Record a debt instead" : "Record a payment instead"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {step === "success" && success ? (
              <View>
                <View style={styles.ok}>
                  <View style={[styles.okIcon, { backgroundColor: theme.colors.tertiary }]}>
                    <Text style={{ color: theme.colors.background, fontSize: 22 }}>✓</Text>
                  </View>
                  <Text style={[styles.title, { color: ink, textAlign: "center" }]}>{success.title}</Text>
                  <Text style={{ color: muted, textAlign: "center", marginTop: 4 }}>{success.body}</Text>
                </View>
                <Pressable
                  style={[styles.filled, { backgroundColor: theme.colors.primary }]}
                  onPress={sendLink}
                  testID="quick-settle-send"
                >
                  <Text style={{ color: theme.colors.onPrimary, fontWeight: "600" }}>{`Send ${first} a link`}</Text>
                </Pressable>
                <Pressable
                  style={[styles.outline, { borderColor: theme.colors.outline }]}
                  onPress={() => {
                    if (savedGroupId) onViewGroup?.(savedGroupId);
                    close();
                  }}
                  testID="quick-settle-view"
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>{`View with ${first}`}</Text>
                </Pressable>
                {undoSeconds > 0 ? (
                  <Pressable onPress={() => void undo()} testID="quick-settle-undo">
                    <Text style={[styles.ghost, { color: theme.colors.primary }]}>{`Undo · ${undoSeconds}s`}</Text>
                  </Pressable>
                ) : null}
                {error ? <Text style={{ color: theme.colors.error, textAlign: "center" }}>{error}</Text> : null}
              </View>
            ) : null}

            {step === "guest" ? (
              <View>
                <Text style={[styles.title, { color: ink }]}>{`Sign in to send ${first} a link`}</Text>
                <Text style={{ color: muted, marginTop: 6, marginBottom: 18 }}>
                  Links need an account. Your record is saved.
                </Text>
                <Pressable style={[styles.filled, { backgroundColor: theme.colors.primary }]} onPress={() => void signInWithGoogle()}>
                  <Text style={{ color: theme.colors.onPrimary, fontWeight: "600" }}>Continue with Google</Text>
                </Pressable>
                <Pressable style={[styles.outline, { borderColor: theme.colors.outline, marginTop: 12 }]} onPress={() => void signInWithApple()}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>Continue with Apple</Text>
                </Pressable>
                <Pressable style={[styles.outline, { borderColor: theme.colors.outline, marginTop: 12 }]} onPress={() => onContinueSignIn?.("email")}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>Continue with email</Text>
                </Pressable>
                <Pressable style={[styles.outline, { borderColor: theme.colors.outline, marginTop: 12 }]} onPress={() => onContinueSignIn?.("whatsapp")}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>Continue with WhatsApp</Text>
                </Pressable>
                <Pressable onPress={() => void shareText()} testID="quick-settle-share-text">
                  <Text style={[styles.ghost, { color: theme.colors.primary }]}>Share as text instead</Text>
                </Pressable>
                <Pressable onPress={() => setStep("success")}>
                  <Text style={[styles.ghost, { color: muted }]}>Not now</Text>
                </Pressable>
              </View>
            ) : null}

            {currencyOpen ? (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  value={currencyQuery}
                  onChangeText={setCurrencyQuery}
                  placeholder="Search currencies"
                  placeholderTextColor={muted}
                  style={[styles.field, { color: ink, borderColor: theme.colors.outline }]}
                />
                {filterCurrencies(currencyQuery).slice(0, 8).map((item) => (
                  <Pressable
                    key={item.code}
                    onPress={() => {
                      setCurrency(item.code);
                      setCurrencyOpen(false);
                      setCurrencyQuery("");
                    }}
                    style={styles.currencyRow}
                  >
                    <Text style={{ color: ink }}>{item.code}</Text>
                    <Text style={{ color: muted }}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,23,29,0.32)" },
  scrimTap: { flex: 1 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 28, maxHeight: "88%" },
  handle: { width: 32, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8, marginBottom: 14, opacity: 0.5 },
  title: { fontSize: 20, fontWeight: "700", letterSpacing: -0.2 },
  search: { height: 48, borderRadius: 24, paddingHorizontal: 16, justifyContent: "center", marginTop: 14, marginBottom: 4 },
  searchInput: { fontSize: 16, padding: 0 },
  person: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  personText: { flex: 1 },
  personName: { fontSize: 16, fontWeight: "600" },
  personAmount: { alignItems: "flex-end" },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarAdd: { borderWidth: 1.5, borderStyle: "dashed", backgroundColor: "transparent" },
  addRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  tag: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: "hidden", textTransform: "uppercase" },
  offer: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingTop: 14, marginBottom: 18 },
  offerTitle: { fontWeight: "700", fontSize: 16, marginBottom: 6 },
  offerLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  filled: { height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  outline: { height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ghost: { textAlign: "center", fontWeight: "600", fontSize: 15, paddingVertical: 12 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 22, overflow: "hidden", minHeight: 44, marginBottom: 18 },
  segmentItem: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, paddingVertical: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 2, marginBottom: 18, paddingBottom: 8 },
  currency: { height: 32, borderRadius: 8, paddingHorizontal: 10, justifyContent: "center" },
  bigAmount: { fontSize: 40, fontWeight: "700", letterSpacing: -0.8 },
  amountInput: { flex: 1, minWidth: 80, padding: 0 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  field: { height: 52, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, fontSize: 16, marginBottom: 16 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  dateChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, height: 36, justifyContent: "center" },
  ok: { alignItems: "center", marginBottom: 18 },
  okIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  currencyRow: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
