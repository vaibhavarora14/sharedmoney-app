import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Button, Chip, Dialog, Portal, RadioButton, Text, TextInput, useTheme } from "react-native-paper";
import type { Participant, RecurringCadence, RecurringTemplate } from "../types";
import { getDefaultCurrency } from "../utils/currency";
import {
  useRecurringTemplates,
  type RecurringTemplateWrite,
} from "../hooks/useRecurringTemplates";

const PRESETS = ["Rent", "Utilities", "Internet", "Custom"] as const;

function statusLabel(template: RecurringTemplate): string {
  if (template.current_status === "due") return `Due ${template.due_on}`;
  if (template.current_status === "upcoming") return `Next ${template.due_on}`;
  if (template.current_status === "added") return "Added this cycle";
  if (template.current_status === "skipped") return "Skipped this cycle";
  return "Paused";
}

function cadenceLabel(cadence: RecurringCadence): string {
  if (cadence === "weekly") return "Weekly";
  if (cadence === "yearly") return "Yearly";
  return "Monthly";
}

export function RecurringTemplatesSheet({
  visible,
  groupId,
  groupName,
  templates,
  participants,
  defaultCurrency,
  currentUserParticipantId,
  onDismiss,
  onExpenseCreated,
}: {
  visible: boolean;
  groupId: string;
  groupName: string;
  templates: RecurringTemplate[];
  participants: Participant[];
  defaultCurrency?: string;
  currentUserParticipantId?: string | null;
  onDismiss: () => void;
  onExpenseCreated?: () => void;
}) {
  const theme = useTheme();
  const hooks = useRecurringTemplates(groupId, onExpenseCreated);
  const [composerOpen, setComposerOpen] = useState(false);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("Rent");
  const [title, setTitle] = useState("Rent");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<RecurringCadence>("monthly");
  const currency = defaultCurrency || getDefaultCurrency();
  const activePeople = useMemo(
    () => participants.filter((person) => person.type !== "former"),
    [participants],
  );

  const resetComposer = (next: (typeof PRESETS)[number]) => {
    setPreset(next);
    setTitle(next === "Custom" ? "" : next);
  };

  const submit = () => {
    const parsed = Number.parseFloat(amount);
    if (!title.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert("Add a name and an amount to save this template.");
      return;
    }
    const payload: RecurringTemplateWrite = {
      title: title.trim(),
      amount: parsed,
      currency,
      category: preset === "Custom" ? title.trim() : preset,
      cadence,
      anchor_date: new Date().toISOString().slice(0, 10),
      paid_by_participant_id: currentUserParticipantId
        || activePeople[0]?.id
        || null,
      split_among_participant_ids: activePeople.map((person) => person.id),
    };
    void hooks.createTemplate.mutateAsync(payload)
      .then(() => {
        setComposerOpen(false);
        setAmount("");
        resetComposer("Rent");
      })
      .catch((error) => {
        Alert.alert("Couldn’t save template", error instanceof Error ? error.message : "Please try again.");
      });
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} testID="recurring-templates-dialog" style={styles.dialog}>
        <Dialog.Title>Recurring in {groupName}</Dialog.Title>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
              Templates remind the group when rent or a utility is due. They never post an expense on their own. Add it, skip this cycle, or pause.
            </Text>
            {templates.length === 0 && !composerOpen ? (
              <Text variant="bodyMedium" style={{ marginBottom: 12 }}>No recurring templates yet.</Text>
            ) : null}
            {templates.map((template) => (
              <View key={template.id} style={[styles.row, { borderColor: theme.colors.outlineVariant }]} testID={`recurring-template-${template.id}`}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{template.title}</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {template.currency} {Number(template.amount).toFixed(2)} · {cadenceLabel(template.cadence)} · {statusLabel(template)}
                  </Text>
                </View>
                <View style={styles.actions}>
                  {template.current_status === "due" ? (
                    <>
                      <Button compact onPress={() => void hooks.addDueExpense(template).catch((error) => Alert.alert("Couldn’t add expense", error instanceof Error ? error.message : "Please try again."))} disabled={hooks.isWorking}>Add</Button>
                      <Button compact onPress={() => void hooks.recordCycle.mutateAsync({ template_id: template.id, action: "skip", period_key: template.current_period_key }).catch((error) => Alert.alert("Couldn’t skip", error instanceof Error ? error.message : "Please try again."))} disabled={hooks.isWorking}>Skip</Button>
                    </>
                  ) : null}
                  <Button
                    compact
                    onPress={() => void hooks.updateTemplate.mutateAsync({ id: template.id, status: template.status === "paused" ? "active" : "paused" })}
                    disabled={hooks.isWorking}
                  >
                    {template.status === "paused" ? "Resume" : "Pause"}
                  </Button>
                </View>
              </View>
            ))}
            {composerOpen ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <View style={styles.presets}>
                  {PRESETS.map((item) => (
                    <Chip key={item} selected={preset === item} onPress={() => resetComposer(item)} compact>{item}</Chip>
                  ))}
                </View>
                <TextInput label="Name" value={title} onChangeText={setTitle} mode="outlined" testID="recurring-template-title" />
                <TextInput label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" mode="outlined" testID="recurring-template-amount" />
                <RadioButton.Group onValueChange={(value) => { if (value === "weekly" || value === "monthly" || value === "yearly") setCadence(value); }} value={cadence}>
                  <RadioButton.Item label="Weekly" value="weekly" />
                  <RadioButton.Item label="Monthly" value="monthly" />
                  <RadioButton.Item label="Yearly" value="yearly" />
                </RadioButton.Group>
              </View>
            ) : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Close</Button>
          {composerOpen ? (
            <Button onPress={submit} loading={hooks.createTemplate.isPending} testID="recurring-template-save">Save template</Button>
          ) : (
            <Button onPress={() => setComposerOpen(true)} testID="recurring-template-start-add">Add template</Button>
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

export function RecurringDueBanners({
  templates,
  disabled,
  onAdd,
  onSkip,
}: {
  templates: RecurringTemplate[];
  disabled?: boolean;
  onAdd: (template: RecurringTemplate) => void;
  onSkip: (template: RecurringTemplate) => void;
}) {
  const theme = useTheme();
  const due = templates.filter((template) => template.current_status === "due");
  if (due.length === 0) return null;
  return (
    <View style={styles.banners} testID="recurring-due-banners">
      {due.map((template) => (
        <View key={template.id} style={[styles.banner, { backgroundColor: theme.colors.secondaryContainer }]}>
          <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSecondaryContainer }}>
            {template.title} is due ({template.currency} {Number(template.amount).toFixed(2)})
          </Text>
          <Button compact onPress={() => onAdd(template)} disabled={disabled}>Add</Button>
          <Button compact onPress={() => onSkip(template)} disabled={disabled}>Skip</Button>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dialog: { maxHeight: "85%" },
  scrollArea: { maxHeight: 420, paddingHorizontal: 0 },
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end" },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  banners: { paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  banner: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 4 },
});
