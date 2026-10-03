import React, { useEffect, useMemo, useState } from "react";
import { Alert, Clipboard, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import {
  Avatar,
  Button,
  Menu,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { PersonSettlementView } from "../hooks/usePeopleSettlements";
import { formatCurrency } from "../utils/currency";
import { formatBreakdown } from "../utils/currencyMerge";
import { openAppExternalUrl } from "../utils/openAppExternalUrl";
import {
  canRecordSettlementLine,
  personSettleActionLabel,
  personSettlePlan,
  type GroupSettlementLine,
} from "../utils/peopleSettlements";
import {
  buildSettleHandoffPack,
  settleHandoffPersonKey,
  settleHandoffSelfKey,
  type SettleHandoffAction,
  type SettleHandoffDetails,
} from "../utils/settleHandoff";
import {
  loadSettleHandoffDetails,
  saveSettleHandoffDetails,
} from "../utils/settleHandoffStorage";

interface PeopleSettlementsListProps {
  people: PersonSettlementView[];
  confirmingPerson: PersonSettlementView | null;
  submitting?: boolean;
  preview?: boolean;
  currentUserName?: string | null;
  currentUserCountryCode?: string | null;
  deviceCountryCode?: string | null;
  profileCountryCodesByUserId?: Record<string, string | null | undefined>;
  onSettlePerson: (person: PersonSettlementView) => void;
  onConfirmPerson: () => void;
  onCancelPerson: () => void;
  onSettleLine?: (line: GroupSettlementLine) => void;
  onSharePerson?: (person: PersonSettlementView, paymentUrl?: string | null) => void;
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

function personUsesSelfPayout(person: PersonSettlementView): boolean {
  const visible = person.lines.filter((line) => Math.abs(line.amount) >= 0.005);
  return visible.length > 0 && visible.every((line) => line.direction === "receive");
}

const COUNTRY_CHOICES = [
  { code: "US", label: "United States" },
  { code: "IN", label: "India" },
  { code: "EU", label: "Euro area" },
  { code: "BR", label: "Brazil" },
];

type SettleHandoffPackViewProps = {
  person: PersonSettlementView;
  currentUserName?: string | null;
  currentUserCountryCode?: string | null;
  deviceCountryCode?: string | null;
  profileCountryCode?: string | null;
  onShareUrlChange?: (url: string | null) => void;
};

const SettleHandoffPackView: React.FC<SettleHandoffPackViewProps> = ({
  person,
  currentUserName,
  currentUserCountryCode,
  deviceCountryCode,
  profileCountryCode,
  onShareUrlChange,
}) => {
  const theme = useTheme();
  const [details, setDetails] = useState<SettleHandoffDetails>({});
  const [countryMenuVisible, setCountryMenuVisible] = useState(false);
  const detailKey = personUsesSelfPayout(person)
    ? settleHandoffSelfKey()
    : settleHandoffPersonKey({
        userId: person.userId,
        email: person.email,
        displayName: person.displayName,
      });

  useEffect(() => {
    let mounted = true;
    loadSettleHandoffDetails(detailKey)
      .then((stored) => {
        if (mounted) setDetails(stored);
      })
      .catch(() => {
        if (mounted) setDetails({});
      });
    return () => {
      mounted = false;
    };
  }, [detailKey]);

  const pack = useMemo(() => {
    const payeeCountryCode = personUsesSelfPayout(person)
      ? currentUserCountryCode
      : profileCountryCode;

    return buildSettleHandoffPack({
      lines: person.lines.map((line) => ({
        counterpartyName: person.displayName,
        direction: line.direction,
        amount: line.amount,
        currency: line.currency,
        groupName: line.groupName,
      })),
      counterpartyName: person.displayName,
      currentUserName,
      details,
      country: {
        profileCountryCode: payeeCountryCode,
        localeCountryCode: deviceCountryCode,
      },
    });
  }, [
    currentUserCountryCode,
    currentUserName,
    details,
    deviceCountryCode,
    person,
    profileCountryCode,
  ]);

  useEffect(() => {
    onShareUrlChange?.(pack.shareUrl);
  }, [onShareUrlChange, pack.shareUrl]);

  const updateDetails = (patch: Partial<SettleHandoffDetails>) => {
    const next = { ...details, ...patch };
    setDetails(next);
    saveSettleHandoffDetails(detailKey, next).catch(() => undefined);
  };

  const handleCopy = (text: string) => {
    Clipboard.setString(text);
  };

  const handleOpen = async (url: string) => {
    if (url.startsWith("upi://")) {
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert("Couldn't open app", "You can still copy the details and pay outside SharedMoney.");
      }
      return;
    }

    await openAppExternalUrl(url, {
      errorTitle: "Couldn't open app",
    });
  };

  const renderAction = (action: SettleHandoffAction) => (
    <Button
      key={action.id}
      mode={action.kind === "open" ? "contained-tonal" : "outlined"}
      compact
      onPress={() => {
        if (action.kind === "open") {
          void handleOpen(action.url);
          return;
        }
        handleCopy(action.copyText);
      }}
      style={styles.handoffButton}
    >
      {action.label}
    </Button>
  );

  return (
    <View
      style={[
        styles.handoff,
        {
          backgroundColor: theme.colors.surfaceVariant,
          borderColor: theme.colors.outlineVariant,
        },
      ]}
    >
      <View style={styles.handoffHeader}>
        <View style={styles.handoffTitle}>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurface, fontWeight: "700" }}>
            Pay outside the app
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Opens their app. SharedMoney never moves the money.
          </Text>
        </View>
        <Menu
          visible={countryMenuVisible}
          onDismiss={() => setCountryMenuVisible(false)}
          anchor={
            <Button
              mode="text"
              compact
              onPress={() => setCountryMenuVisible(true)}
            >
              {pack.countryLabel}
            </Button>
          }
        >
          {COUNTRY_CHOICES.map((choice) => (
            <Menu.Item
              key={choice.code}
              title={choice.label}
              onPress={() => {
                setCountryMenuVisible(false);
                updateDetails({ countryOverride: choice.code });
              }}
            />
          ))}
        </Menu>
      </View>

      {pack.pack === "US" ? (
        <View style={styles.handoffFields}>
          <TextInput
            mode="outlined"
            dense
            placeholder="Venmo username"
            value={details.venmoHandle ?? ""}
            onChangeText={(value) => updateDetails({ venmoHandle: value })}
          />
          <TextInput
            mode="outlined"
            dense
            placeholder="$cashtag"
            value={details.cashAppCashtag ?? ""}
            onChangeText={(value) => updateDetails({ cashAppCashtag: value })}
          />
          <TextInput
            mode="outlined"
            dense
            placeholder="PayPal.me name"
            value={details.paypalMe ?? ""}
            onChangeText={(value) => updateDetails({ paypalMe: value })}
          />
        </View>
      ) : null}

      {pack.pack === "IN" ? (
        <View style={styles.handoffFields}>
          <TextInput
            mode="outlined"
            dense
            placeholder="UPI ID"
            value={details.upiVpa ?? ""}
            autoCapitalize="none"
            onChangeText={(value) => updateDetails({ upiVpa: value })}
          />
        </View>
      ) : null}

      {pack.pack === "EU" ? (
        <View style={styles.handoffFields}>
          <TextInput
            mode="outlined"
            dense
            placeholder="IBAN"
            value={details.iban ?? ""}
            autoCapitalize="characters"
            onChangeText={(value) => updateDetails({ iban: value })}
          />
          <TextInput
            mode="outlined"
            dense
            placeholder="Name on account"
            value={details.ibanName ?? ""}
            onChangeText={(value) => updateDetails({ ibanName: value })}
          />
        </View>
      ) : null}

      {pack.pack === "BR" ? (
        <View style={styles.handoffFields}>
          <TextInput
            mode="outlined"
            dense
            placeholder="Pix key"
            value={details.pixKey ?? ""}
            autoCapitalize="none"
            onChangeText={(value) => updateDetails({ pixKey: value })}
          />
        </View>
      ) : null}

      <View style={styles.handoffActions}>
        {pack.actions.map(renderAction)}
      </View>
    </View>
  );
};

export const PeopleSettlementsList: React.FC<PeopleSettlementsListProps> = ({
  people,
  confirmingPerson,
  submitting = false,
  preview = false,
  currentUserName,
  currentUserCountryCode,
  deviceCountryCode,
  profileCountryCodesByUserId = {},
  onSettlePerson,
  onConfirmPerson,
  onCancelPerson,
  onSettleLine,
  onSharePerson,
}) => {
  const theme = useTheme();
  const [shareUrls, setShareUrls] = useState<Record<string, string | null>>({});

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

            <SettleHandoffPackView
              person={person}
              currentUserName={currentUserName}
              currentUserCountryCode={currentUserCountryCode}
              deviceCountryCode={deviceCountryCode}
              profileCountryCode={
                person.userId ? profileCountryCodesByUserId[person.userId] ?? null : null
              }
              onShareUrlChange={(url) => {
                setShareUrls((current) => (
                  current[person.key] === url ? current : { ...current, [person.key]: url }
                ));
              }}
            />

            <Button
              mode="outlined"
              icon="share-variant"
              testID={`share-in-chat-${person.key}`}
              accessibilityLabel={`Share in chat with ${person.displayName}`}
              onPress={onSharePerson ? () => onSharePerson(person, shareUrls[person.key] ?? null) : undefined}
              disabled={person.lines.length === 0 || !onSharePerson}
              style={styles.shareInChat}
            >
              Share in chat
            </Button>
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
  shareInChat: {
    marginTop: 12,
  },
  handoff: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  handoffHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  handoffTitle: {
    flex: 1,
    gap: 2,
  },
  handoffFields: {
    gap: 8,
  },
  handoffActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  handoffButton: {
    marginTop: 0,
  },
});
