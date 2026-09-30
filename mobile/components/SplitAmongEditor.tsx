import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Button,
  Chip,
  IconButton,
  Icon,
  Menu,
  Text,
  TextInput,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { Participant } from "../types";
import { formatCurrency } from "../utils/currency";
import {
  calculateEqualSplits,
  calculateShareSplits,
  clampShareCount,
  MAX_SHARE_COUNT,
  remainingSplitAmount,
  roundMoney,
  sanitizeAmountInput,
  sharePercent,
  sumSelectedAmounts,
} from "../utils/splits";

export type SplitMode = "equal" | "unequal" | "shares";

interface SplitAmongEditorProps {
  participants: Participant[];
  selectedIds: string[];
  amounts: Record<string, string>;
  /** Blank rows outside an edited expense's original split; still editable. */
  excludedAmountIds?: string[];
  shares: Record<string, number>;
  mode: SplitMode;
  totalAmount: number | null;
  currency: string;
  error?: string;
  disabled?: boolean;
  areAllSelected: boolean;
  onToggleMember: (participantId: string) => void;
  onToggleAll: () => void;
  onModeChange: (mode: SplitMode) => void;
  onAmountChange: (participantId: string, text: string) => void;
  onShareChange: (participantId: string, shares: number) => void;
  onSplitRemaining: () => void;
}

function displayName(participant: Participant): string {
  return participant.full_name
    || participant.email?.split("@")[0]
    || participant.email
    || "Unknown";
}

export const SplitAmongEditor: React.FC<SplitAmongEditorProps> = ({
  participants,
  selectedIds,
  amounts,
  excludedAmountIds = [],
  shares,
  mode,
  totalAmount,
  currency,
  error,
  disabled,
  areAllSelected,
  onToggleMember,
  onToggleAll,
  onModeChange,
  onAmountChange,
  onShareChange,
  onSplitRemaining,
}) => {
  const theme = useTheme();
  const [modeMenuVisible, setModeMenuVisible] = useState(false);
  const selectionTheme = {
    colors: {
      secondaryContainer: theme.colors.primaryContainer,
      onSecondaryContainer: theme.colors.onPrimaryContainer,
    },
  };
  // Shared selection across Equal / Amounts / Shares — never re-expand to the full group.
  const effectiveIds = useMemo(() => selectedIds, [selectedIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedParticipants = useMemo(
    () => participants.filter((participant) => selectedSet.has(participant.id)),
    [participants, selectedSet],
  );
  const hasTotal = totalAmount !== null && totalAmount > 0;

  const assignedAmounts = useMemo(() => {
    if (!hasTotal || effectiveIds.length === 0) return {} as Record<string, number>;
    if (mode === "equal") {
      return Object.fromEntries(
        calculateEqualSplits(totalAmount, effectiveIds).map((split) => [
          split.participant_id,
          split.amount,
        ]),
      );
    }
    if (mode === "shares") {
      return Object.fromEntries(
        calculateShareSplits(totalAmount, effectiveIds, shares).map((split) => [
          split.participant_id,
          split.amount,
        ]),
      );
    }
    return Object.fromEntries(
      effectiveIds.map((id) => [id, sumSelectedAmounts({ [id]: amounts[id] ?? "" }, [id])]),
    );
  }, [amounts, hasTotal, mode, effectiveIds, shares, totalAmount]);

  const assigned = useMemo(
    () => roundMoney(effectiveIds.reduce((sum, id) => sum + (assignedAmounts[id] ?? 0), 0)),
    [assignedAmounts, effectiveIds],
  );
  const remaining = hasTotal ? remainingSplitAmount(totalAmount, assigned) : null;
  const leftover = remaining !== null && remaining > 0.01;
  const over = remaining !== null && remaining < -0.01;
  const exact = remaining !== null && !leftover && !over && effectiveIds.length > 0;
  const statusColor = over
    ? theme.colors.error
    : exact
      ? theme.colors.primary
      : theme.colors.onSurfaceVariant;

  const modeLabel =
    mode === "equal" ? "Equal" : mode === "unequal" ? "Amounts" : "Shares";
  const roundingError = hasTotal && mode !== "unequal" &&
    effectiveIds.some((id) => !(assignedAmounts[id] > 0))
    ? mode === "equal"
      ? "Each person's split must round to an amount greater than 0. Increase the amount or select fewer people."
      : "Each person's share must round to an amount greater than 0. Increase the amount or adjust the shares."
    : undefined;
  const selectionError = error || (selectedIds.length === 0
    ? "Select at least one person"
    : roundingError);

  return (
    <View testID="split-among-editor">
      <View style={styles.sectionHeaderWithAction}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          Split among
        </Text>
        <View style={styles.headerActions}>
          <Menu
            nativeModal
            visible={modeMenuVisible && !disabled}
            onDismiss={() => setModeMenuVisible(false)}
            anchorPosition="bottom"
            testID="split-mode-menu"
            anchor={
              <TouchableRipple
                style={styles.modeButton}
                onPress={() => setModeMenuVisible(true)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Split method: ${modeLabel}`}
                accessibilityState={{ expanded: modeMenuVisible && !disabled, disabled: !!disabled }}
                testID="split-mode-dropdown"
              >
                <View style={styles.modeButtonContent}>
                  <Text variant="labelLarge" style={{ color: disabled ? theme.colors.onSurfaceDisabled : theme.colors.primary }}>{modeLabel}</Text>
                  <Icon source="chevron-down" size={18} color={disabled ? theme.colors.onSurfaceDisabled : theme.colors.primary} />
                </View>
              </TouchableRipple>
            }
          >
            {([
              { value: "equal", label: "Equal" },
              { value: "unequal", label: "Amounts" },
              { value: "shares", label: "Shares" },
            ] as const).map((option) => (
              <Menu.Item
                key={option.value}
                title={option.label}
                accessibilityState={{ selected: mode === option.value }}
                trailingIcon={mode === option.value ? "check" : undefined}
                disabled={disabled}
                onPress={() => {
                  setModeMenuVisible(false);
                  onModeChange(option.value);
                }}
                testID={`split-mode-${option.value}`}
              />
            ))}
          </Menu>
          {!areAllSelected && participants.length > 0 ? (
            <Button mode="text" compact onPress={onToggleAll} disabled={disabled} testID="split-select-all">
              Select all
            </Button>
          ) : null}
        </View>
      </View>

      {selectionError ? (
        <Text variant="bodySmall" accessibilityLiveRegion="polite" style={{ color: theme.colors.error, marginBottom: 8 }}>
          {selectionError}
        </Text>
      ) : null}

      <View style={styles.chipWrap}>
        {participants.map((participant) => {
          const selected = selectedSet.has(participant.id);
          const isFormer = participant.type === "former";
          return (
            <Chip
              key={participant.id}
              selected={selected}
              onPress={() => onToggleMember(participant.id)}
              style={[
                styles.wrapChip,
                isFormer && styles.formerChip,
                !selected && { backgroundColor: theme.colors.surfaceVariant },
              ]}
              theme={selectionTheme}
              disabled={disabled}
              showSelectedCheck
              testID={`split-among-chip-${participant.email || participant.id}`}
            >
              {displayName(participant)}
              {isFormer ? " (Former)" : ""}
            </Chip>
          );
        })}
      </View>

      {mode === "equal" && hasTotal && selectedIds.length > 0 ? (
        <View style={[styles.summary, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Each person pays:{" "}
            <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>
              {formatCurrency(totalAmount / selectedIds.length, currency)}
            </Text>
          </Text>
        </View>
      ) : null}

      {mode !== "equal" && participants.length === 0 ? (
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
          No people available.
        </Text>
      ) : null}

      {mode !== "equal" ? (
        <View style={styles.detailList}>
          {selectedParticipants.map((participant) => {
            const name = displayName(participant);
            const personAmount = assignedAmounts[participant.id] ?? 0;
            const percent = hasTotal ? sharePercent(personAmount, totalAmount) : 0;
            const shareCount = clampShareCount(shares[participant.id] ?? 1);
            const isExcluded = mode === "unequal" && excludedAmountIds.includes(participant.id);

            return (
              <View key={participant.id} style={styles.detailRow}>
                <View style={styles.detailCopy}>
                  <Text variant="bodyLarge" numberOfLines={1}>
                    {name}
                    {participant.type === "former" ? " (Former)" : ""}
                  </Text>
                  {isExcluded ? (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      Not included
                    </Text>
                  ) : hasTotal ? (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {percent}% · {formatCurrency(personAmount, currency)}
                    </Text>
                  ) : null}
                </View>

                {mode === "unequal" ? (
                  <TextInput
                    mode="outlined"
                    dense
                    value={amounts[participant.id] ?? ""}
                    accessibilityLabel={`Amount for ${name}, ${currency}${isExcluded ? ", Not included" : ""}`}
                    onChangeText={(text) => {
                      const next = sanitizeAmountInput(text);
                      if (next === null) return;
                      onAmountChange(participant.id, next);
                    }}
                    keyboardType="decimal-pad"
                    disabled={disabled}
                    style={[styles.amountInput, { backgroundColor: theme.colors.surface }]}
                    outlineColor={theme.colors.outline}
                    activeOutlineColor={theme.colors.primary}
                    placeholder="0.00"
                    testID={`split-amount-input-${participant.email || participant.id}`}
                  />
                ) : (
                  <View style={styles.shareStepper}>
                    <IconButton
                      icon="minus"
                      size={20}
                      disabled={disabled || shareCount <= 1}
                      onPress={() => onShareChange(participant.id, shareCount - 1)}
                      accessibilityLabel={`Fewer shares for ${name}`}
                      accessibilityValue={{ min: 1, max: MAX_SHARE_COUNT, now: shareCount, text: `${shareCount} shares` }}
                    />
                    <Text
                      variant="titleMedium"
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={`${name}, ${shareCount} shares${hasTotal ? `, ${percent}%, ${formatCurrency(personAmount, currency)}` : ""}`}
                      style={{ color: theme.colors.onSurface, minWidth: 20, textAlign: "center" }}
                    >
                      {shareCount}
                    </Text>
                    <IconButton
                      icon="plus"
                      size={20}
                      disabled={disabled || shareCount >= MAX_SHARE_COUNT}
                      onPress={() => onShareChange(participant.id, shareCount + 1)}
                      accessibilityLabel={`More shares for ${name}`}
                      accessibilityValue={{ min: 1, max: MAX_SHARE_COUNT, now: shareCount, text: `${shareCount} shares` }}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {mode !== "equal" && hasTotal && effectiveIds.length > 0 ? (
        <View
          style={[styles.summary, { backgroundColor: theme.colors.surfaceVariant }]}
          testID="split-remaining-label"
        >
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
            {exact
              ? "Splits add up: "
              : leftover
                ? "Left to assign: "
                : "Over by: "}
            <Text style={{ color: statusColor, fontWeight: "600" }}>
              {exact
                ? formatCurrency(totalAmount, currency)
                : formatCurrency(Math.abs(remaining ?? 0), currency)}
            </Text>
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            {formatCurrency(assigned, currency)} of {formatCurrency(totalAmount, currency)}
          </Text>
          {mode === "unequal" && leftover ? (
            <Button
              mode="text"
              compact
              onPress={onSplitRemaining}
              disabled={disabled}
              testID="split-leftover-button"
            >
              Split leftover
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeaderWithAction: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  modeButton: {
    borderRadius: 20,
    overflow: "hidden",
  },
  modeButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
    gap: 8,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  wrapChip: {
    marginBottom: 4,
  },
  formerChip: {
    opacity: 0.7,
  },
  summary: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  detailList: {
    marginTop: 8,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
  },
  amountInput: {
    width: 112,
  },
  shareStepper: {
    flexDirection: "row",
    alignItems: "center",
  },
});
