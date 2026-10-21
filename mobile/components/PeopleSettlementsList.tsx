import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import {
  Avatar,
  Button,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { PersonSettlementView } from "../hooks/usePeopleSettlements";
import { formatCurrency } from "../utils/currency";
import { formatBreakdown } from "../utils/currencyMerge";
import {
  canRecordSettlementLine,
  personSettleActionLabel,
  personSettlePlan,
  type GroupSettlementLine,
} from "../utils/peopleSettlements";

interface PeopleSettlementsListProps {
  people: PersonSettlementView[];
  confirmingPerson: PersonSettlementView | null;
  submitting?: boolean;
  preview?: boolean;
  onSettlePerson: (person: PersonSettlementView) => void;
  onConfirmPerson: () => void;
  onCancelPerson: () => void;
  onSettleLine?: (line: GroupSettlementLine) => void;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function verbLabel(verb: PersonSettlementView["headline"]["verb"]): string {
  if (verb === "pay") return "You owe";
  if (verb === "receive") return "Owes you";
  if (verb === "mixed") return "Open both ways";
  return "Settled";
}

export const PeopleSettlementsList: React.FC<PeopleSettlementsListProps> = ({
  people,
  confirmingPerson,
  submitting = false,
  preview = false,
  onSettlePerson,
  onConfirmPerson,
  onCancelPerson,
  onSettleLine,
}) => {
  const theme = useTheme();

  return (
    <View style={styles.list}>
      {people.map((person) => {
        const amountColor = person.headline.verb === "receive"
          ? theme.colors.tertiary
          : person.headline.verb === "pay"
            ? theme.colors.error
            : theme.colors.onSurface;
        const groupNames = [...new Set(person.lines.map((line) => line.groupName))];
        const plan = personSettlePlan(person);
        const actionLabel = personSettleActionLabel(person, person.headline, { compact: true });

        return (
          <Surface
            key={person.key}
            testID={`person-settlement-${person.key}`}
            style={[
              styles.personCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
            elevation={0}
          >
            <View style={styles.personHeader}>
              {person.avatarUrl ? (
                <Avatar.Image source={{ uri: person.avatarUrl }} size={44} />
              ) : (
                <Avatar.Text
                  size={44}
                  label={initials(person.displayName)}
                  style={{ backgroundColor: theme.colors.surfaceVariant }}
                  color={theme.colors.onSurfaceVariant}
                  labelStyle={{ fontWeight: "700" }}
                />
              )}
              <View style={styles.personInfo}>
                <Text variant="titleMedium" style={{ fontWeight: "700", color: theme.colors.onSurface }}>
                  {person.displayName}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {groupNames.join(" · ")}
                </Text>
              </View>
              <View style={styles.personNet}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {verbLabel(person.headline.verb)}
                </Text>
                <Text variant="titleMedium" style={{ color: amountColor, fontWeight: "800" }}>
                  {person.headline.headline}
                </Text>
              </View>
            </View>

            {person.headline.breakdown ? (
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
                from {person.headline.breakdown}
              </Text>
            ) : null}

            <View style={styles.lines}>
              {person.lines.map((line) => {
                const isPay = line.direction === "pay";
                const lineColor = isPay ? theme.colors.error : theme.colors.tertiary;
                const chipBg = isPay ? theme.colors.errorContainer : theme.colors.tertiaryContainer;
                const chipFg = isPay ? theme.colors.onErrorContainer : theme.colors.onTertiaryContainer;
                const canSettle = canRecordSettlementLine(line);

                return (
                  <TouchableRipple
                    key={`${line.groupId}-${line.currency}-${line.direction}`}
                    testID={`settle-line-${line.groupId}-${person.key}`}
                    onPress={() => onSettleLine?.(line)}
                    disabled={!canSettle || !onSettleLine}
                    style={[
                      styles.lineRipple,
                      Platform.OS === "web" ? { outlineStyle: "solid", outlineWidth: 0 } : null,
                    ]}
                  >
                    <View style={styles.lineRow}>
                      <View style={styles.lineInfo}>
                        <Text variant="bodyLarge" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                          {line.groupName}
                        </Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          {isPay ? "you owe" : "owes you"}
                          {line.originalParts.length > 0 ? ` · ${formatBreakdown(line.originalParts)}` : ""}
                        </Text>
                      </View>
                      <View style={styles.lineAmount}>
                        <Text variant="titleSmall" style={{ color: lineColor, fontWeight: "700" }}>
                          {formatCurrency(line.amount, line.currency)}
                        </Text>
                        <View style={[styles.chip, { backgroundColor: chipBg }]}>
                          <Text variant="labelSmall" style={{ color: chipFg, fontWeight: "700", letterSpacing: 0.4 }}>
                            {isPay ? "PAY" : "RECEIVE"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </TouchableRipple>
                );
              })}
            </View>

            {confirmingPerson?.key === person.key ? (
              <View testID="settle-person-sheet" style={styles.confirm}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                  {plan.groupCount > 1
                    ? `This records a payment in each of ${plan.groupCount} groups. Cash between you is the net.`
                    : "This records the payment in that group."}
                </Text>
                {preview ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Preview only — nothing is written until you do this on a real account.
                  </Text>
                ) : null}
                <Button
                  mode="contained"
                  testID="confirm-settle-person"
                  onPress={onConfirmPerson}
                  {...(Platform.OS === "web" ? { onClick: onConfirmPerson } : {})}
                  loading={submitting}
                  disabled={submitting || !plan.canSettleAll}
                >
                  {personSettleActionLabel(person, person.headline)}
                </Button>
                <Button mode="text" onPress={onCancelPerson} disabled={submitting}>
                  Cancel
                </Button>
              </View>
            ) : (
              <Pressable
                testID={`settle-person-${person.key}`}
                accessibilityRole="button"
                onPress={() => onSettlePerson(person)}
                disabled={!plan.canSettleAll}
                {...(Platform.OS === "web"
                  ? { onClick: () => onSettlePerson(person) }
                  : {})}
                style={[
                  styles.settleAll,
                  {
                    backgroundColor: plan.canSettleAll
                      ? theme.colors.primary
                      : theme.colors.surfaceDisabled,
                    borderRadius: 24,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                  },
                ]}
              >
                <Text
                  variant="labelLarge"
                  style={{
                    color: plan.canSettleAll
                      ? theme.colors.onPrimary
                      : theme.colors.onSurfaceDisabled,
                    textAlign: "center",
                    fontWeight: "700",
                  }}
                >
                  {actionLabel}
                </Text>
              </Pressable>
            )}
          </Surface>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    gap: 16,
  },
  personCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  personHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  personInfo: {
    flex: 1,
    gap: 2,
  },
  personNet: {
    alignItems: "flex-end",
    gap: 2,
  },
  lines: {
    marginTop: 12,
    gap: 2,
  },
  lineRipple: {
    borderRadius: 12,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  lineInfo: {
    flex: 1,
    gap: 2,
  },
  lineAmount: {
    alignItems: "flex-end",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    minWidth: 72,
    alignItems: "center",
  },
  settleAll: {
    marginTop: 12,
  },
  confirm: {
    marginTop: 12,
    gap: 8,
  },
});
