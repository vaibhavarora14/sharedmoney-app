import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Share, StyleSheet, View } from "react-native";
import { ActivityIndicator, Appbar, Button, List, Surface, Text, TextInput, useTheme } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { SplitAmongEditor } from "../components/SplitAmongEditor";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { confirmBillSplit, createBillSplit, readBillSplit, useBillSplitPeople } from "../hooks/useBillSplit";
import { useProfile } from "../hooks/useProfile";
import type { Participant } from "../types";
import { allocateBillSplit, billAmountMinor, billSplitUrl, formatBillAmount, type BillSplitMode } from "../utils/billSplit";
import { existingPersonLabel, filterAndSortExistingPeople } from "../utils/peoplePicker";
import { distributeRemaining, sanitizeAmountInput } from "../utils/splits";

const CREATOR = "bill-creator";

function BillSplitForm({ onCreated }: { onCreated: (token: string) => void }) {
  const theme = useTheme();
  const { data: profile } = useProfile();
  const directory = useBillSplitPeople();
  const [amount, setAmount] = useState("");
  const [currencyInput, setCurrency] = useState<string>();
  const currency = currencyInput ?? profile?.preferred_currency ?? "USD";
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
    if (!/^[A-Z]{3}$/.test(currency)) validation = "Enter a three-letter currency code.";
  } catch (err) {
    validation = (err as Error).message;
  }
  const suggestions = filterAndSortExistingPeople(directory.data ?? [], name)
    .filter((person) => !people.some((selected) => selected.id === person.id));

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
      onCreated(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <>
    <Text variant="bodyMedium">A one-time bill. No group needed.</Text>
    <TextInput label="Amount" mode="outlined" value={amount} keyboardType="decimal-pad"
      testID="split-bill-amount" disabled={busy} onChangeText={(text) => {
        const next = sanitizeAmountInput(text);
        if (next !== null) setAmount(next);
      }} />
    <TextInput label="Currency code" mode="outlined" value={currency} maxLength={3}
      autoCapitalize="characters" disabled={busy} onChangeText={(text) => setCurrency(text.toUpperCase())} />
    <Text variant="titleMedium">Who’s on the bill?</Text>
    <Text variant="bodyMedium">You’re included. Add at least one other person.</Text>
    <TextInput label="Find someone or enter a new name" mode="outlined" value={name}
      testID="split-bill-person-input" maxLength={100} disabled={busy || people.length >= 49} onChangeText={setName} />
    <Button mode="outlined" testID="split-bill-add-person" disabled={busy || !name.trim() || people.length >= 49}
      onPress={() => addPerson(`new:${nextPerson.current++}`, name)}>Add by name</Button>
    {directory.isLoading ? <ActivityIndicator /> : null}
    {directory.isError ? <><Text>Couldn’t load known people. You can still add by name.</Text>
      <Button onPress={() => void directory.refetch()}>Retry people</Button></> : null}
    {suggestions.length > 0 && people.length < 49 ? <View>
      <Text variant="labelLarge">People you know</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
        {suggestions.map((person) => <List.Item key={person.id} title={existingPersonLabel(person)}
          disabled={busy} accessibilityLabel={`Add ${existingPersonLabel(person)}`}
          onPress={() => addPerson(person.id, existingPersonLabel(person))} right={(props) => <List.Icon {...props} icon="plus" />} />)}
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
      <Text key={person.id}>{person.full_name}: {formatBillAmount(allocations[i], currency)}</Text>) : null}
    {validation ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.onSurfaceVariant }}>{validation}</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.error }}>{error}</Text> : null}
    <Text variant="bodySmall">The link is available for 30 days. Anyone with it can see the names and amounts and acknowledge a share. SharedMoney does not move money.</Text>
    <Button mode="contained" testID="split-bill-create" loading={busy} disabled={busy || !!validation}
      onPress={() => void create()}>Create & get share link</Button>
  </>;
}

function BillSplitDetails({ token }: { token: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const key = ["bill-split-session", token];
  const [busy, setBusy] = useState(false);
  const session = useQuery({ queryKey: key, queryFn: () => readBillSplit(token), enabled: !busy, refetchInterval: busy ? false : 15_000, retry: false });
  const [message, setMessage] = useState("");
  const confirming = useRef(false);
  const url = billSplitUrl(token);
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

  if (session.isPending) return <ActivityIndicator accessibilityLabel="Loading bill" />;
  if (session.isError) return <><Text>Couldn’t load this bill.</Text><Button onPress={() => void session.refetch()}>Try again</Button></>;
  if (!session.data) return <><Text variant="headlineSmall">Bill not found</Text><Text>This link is invalid or has expired.</Text></>;
  return <>
    <Text variant="labelLarge">Total · {session.data.mode === "unequal" ? "Exact amounts" : session.data.mode === "shares" ? "Shares" : "Equal split"}</Text>
    <Text variant="headlineLarge">{formatBillAmount(session.data.amount_minor, session.data.currency)}</Text>
    <Text>Choose your name to confirm your share. This is an acknowledgement only; no money moves.</Text>
    {session.data.participants.map((person) => <Surface key={person.id} elevation={0}
      style={[styles.person, { backgroundColor: theme.colors.surfaceVariant }]}>
      <Text variant="titleMedium">{person.display_name}</Text>
      <Text variant="bodyLarge">{formatBillAmount(person.amount_minor, session.data!.currency)}</Text>
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

export function SplitBillScreen({ token: initialToken, onDismiss }: { token?: string; onDismiss: () => void }) {
  const theme = useTheme();
  const [token, setToken] = useState(initialToken);
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
        <Appbar.BackAction onPress={onDismiss} /><Appbar.Content title="Split a bill" />
      </Appbar.Header>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {token ? <BillSplitDetails key={token} token={token} /> : <BillSplitForm onCreated={setToken} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16, width: "100%", maxWidth: WEB_MAX_WIDTH, alignSelf: "center" },
  person: { padding: 16, borderRadius: 12, gap: 8 },
});
