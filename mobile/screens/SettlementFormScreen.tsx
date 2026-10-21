import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import { Appbar, Button, Chip, Dialog, Portal, Text, TextInput, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { Balance, GroupMember, Participant, Settlement } from "../types";
import {
    formatCurrency,
    getCurrencySymbol,
    getDefaultCurrency,
} from "../utils/currency";
import { getUserFriendlyErrorMessage } from "../utils/errorMessages";
import {
  RECORD_SETTLEMENT_LABEL,
  SETTLE_OUTSIDE_APP_HELP,
  UPDATE_SETTLEMENT_LABEL,
} from "../utils/settleCopy";
import {
  formatShareAmountInput,
  parseShareAmountInput,
  settleSharePersonName,
} from "../utils/settleShareMessage";

/** Mid-sentence pronoun in the “X paid Y” header (never title-case). */
const YOU_LABEL = "you";

interface SettlementFormScreenProps {
  visible: boolean;
  balance: Balance | null; // The balance to settle (null = manual entry)
  settlement?: Settlement | null; // The settlement to edit (null = create new)
  groupMembers: GroupMember[];
  currentUserId: string;
  groupId: string;
  defaultCurrency?: string;
  onSave: (data: {
    group_id: string;
    from_participant_id: string;
    to_participant_id: string;
    amount: number;
    currency: string;
    notes?: string;
  }) => Promise<void>;
  onUpdate?: (data: {
    id: string;
    amount?: number;
    currency?: string;
    notes?: string;
    from_participant_id?: string;
    to_participant_id?: string;
    date?: string;
    group_id?: string;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onDismiss: () => void;
  // Admin mode: explicit sender/receiver
  fromParticipantId?: string;
  toParticipantId?: string;
  initialAmount?: number;
  initialCurrency?: string;
  participants?: Participant[];
  /**
   * Owes-you create only: secondary Remind under the primary Record CTA.
   * Parent omits these when the viewer owes the counterparty or when editing.
   * Opening share/WhatsApp must not dismiss this modal.
   */
  remindLabel?: string;
  remindShareAnotherWay?: boolean;
  onRemindPress?: () => void;
  onRemindShareAnotherWay?: () => void;
}

function toDateInputValue(value?: string | null): string {
  if (!value) return new Date().toISOString().split("T")[0];
  const safe = value.endsWith("Z") || value.includes("+") ? value : `${value}Z`;
  const parsed = new Date(safe);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().split("T")[0];
  }
  return parsed.toISOString().split("T")[0];
}

function formatDateForDisplay(dateStr: string): string {
  if (!dateStr) return "Select date";
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatParticipantLabel(
  item: { id: string; user_id?: string | null; full_name?: string | null; email?: string | null },
  all: Array<{ id: string; user_id?: string | null; full_name?: string | null; email?: string | null }>,
  currentUserId?: string
): string {
  const raw = item.full_name?.trim()
    || item.email?.split("@")[0]?.trim()
    || item.email?.trim()
    || `Member ${item.id.substring(0, 8)}`;
  const duplicates = all.filter((other) => {
    const otherRaw = other.full_name?.trim()
      || other.email?.split("@")[0]?.trim()
      || other.email?.trim()
      || `Member ${other.id.substring(0, 8)}`;
    return otherRaw.toLowerCase() === raw.toLowerCase();
  });
  const base = duplicates.length > 1 ? `${raw} · ${item.email || item.id}` : raw;
  const isCurrent = !!(currentUserId && item.user_id === currentUserId);
  return isCurrent ? `${base} (You)` : base;
}

export const SettlementFormScreen: React.FC<SettlementFormScreenProps> = ({
  visible,
  balance,
  settlement,
  groupMembers,
  currentUserId,
  groupId,
  defaultCurrency,
  onSave,
  onUpdate,
  onDelete,
  onDismiss,
  fromParticipantId,
  toParticipantId,
  initialAmount,
  initialCurrency,
  participants = [],
  remindLabel,
  remindShareAnotherWay = false,
  onRemindPress,
  onRemindShareAnotherWay,
}) => {
  const isEditing = !!settlement;
  const isAdminMode = !!(fromParticipantId && toParticipantId);

  // If settling a specific balance, use that currency. Otherwise use default.
  // Note: The form currently does not allow changing currency, so it is effectively locked.
  const effectiveDefaultCurrency =
    settlement?.currency ||
    balance?.currency ||
    initialCurrency ||
    defaultCurrency ||
    getDefaultCurrency();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const chipSelectionTheme = useMemo(() => ({
    colors: {
      secondaryContainer: theme.colors.primaryContainer,
      onSecondaryContainer: theme.colors.onPrimaryContainer,
    },
  }), [theme.colors.primaryContainer, theme.colors.onPrimaryContainer]);

  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [selectedFromParticipantId, setSelectedFromParticipantId] = useState<string>("");
  const [selectedToParticipantId, setSelectedToParticipantId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [amountError, setAmountError] = useState<string>("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Determine settlement direction
  const isPaying = useMemo(() => {
    if (balance) {
      // Negative balance means you owe them, so you're paying
      return balance.amount < 0;
    }
    // For manual entry, we'll assume user is paying (from_user_id = currentUserId)
    return true;
  }, [balance]);

  // Owes-you create only: secondary Remind under primary. You-owe / edit: never.
  const showRemind = !isEditing && !isPaying && !!onRemindPress;

  // Determine fixed payer/receiver display names
  const adminPayer = useMemo(() => {
     if (!fromParticipantId) return null;
     return groupMembers.find(m => m.participant_id === fromParticipantId);
  }, [fromParticipantId, groupMembers]);

  const adminReceiver = useMemo(() => {
     if (!toParticipantId) return null;
     return groupMembers.find(m => m.participant_id === toParticipantId);
  }, [toParticipantId, groupMembers]);

  // Get available users to settle with (excluding current user)
  const availableUsers = useMemo(() => {
    return groupMembers.filter((m) => m.user_id !== currentUserId);
  }, [groupMembers, currentUserId]);

  const editableParticipants = useMemo(() => {
    const list: Array<{ id: string; user_id?: string | null; full_name?: string | null; email?: string | null }> = [];
    const seen = new Set<string>();

    for (const member of groupMembers) {
      if (!member.participant_id || seen.has(member.participant_id)) continue;
      seen.add(member.participant_id);
      list.push({
        id: member.participant_id,
        user_id: member.user_id,
        full_name: member.full_name,
        email: member.email,
      });
    }

    for (const participant of participants) {
      if (!participant.id || seen.has(participant.id)) continue;
      seen.add(participant.id);
      list.push({
        id: participant.id,
        user_id: participant.user_id,
        full_name: participant.full_name,
        email: participant.email,
      });
    }

    return list.map((item) => ({
      ...item,
      label: formatParticipantLabel(item, list, currentUserId),
    }));
  }, [groupMembers, participants, currentUserId]);

  const allMembersList = useMemo(() => {
    return groupMembers.map((member) => ({
      id: member.participant_id || member.user_id || "",
      user_id: member.user_id,
      full_name: member.full_name,
      email: member.email,
      participant_id: member.participant_id,
    }));
  }, [groupMembers]);

  const availableUserList = useMemo(() => {
    return availableUsers.map((member) => ({
      id: member.participant_id || member.user_id || "",
      user_id: member.user_id,
      full_name: member.full_name,
      email: member.email,
      participant_id: member.participant_id,
    }));
  }, [availableUsers]);

  const formatAvailableUserLabel = (member: { id: string; user_id?: string | null; full_name?: string | null; email?: string | null }) => {
    return formatParticipantLabel(member, allMembersList);
  };

  // Initialize form when modal becomes visible
  useEffect(() => {
    if (!visible) {
      setAmount("");
      setNotes("");
      setDate("");
      setSelectedFromParticipantId("");
      setSelectedToParticipantId("");
      setAmountError("");
      setShowDatePicker(false);
      setShowDeleteConfirm(false);
      return;
    }

    // If editing, pre-fill from settlement
    if (settlement) {
      setAmount(
        formatShareAmountInput(
          settlement.amount,
          settlement.currency || effectiveDefaultCurrency,
        ),
      );
      setNotes(settlement.notes || "");
      setDate(toDateInputValue(settlement.created_at));
      setSelectedFromParticipantId(settlement.from_participant_id || "");
      setSelectedToParticipantId(settlement.to_participant_id || "");
    }
    // Pre-fill based on balance if provided
    else if (balance) {
      const member = groupMembers.find(m => m.user_id === balance.user_id);
      // For invited users, balance.user_id IS the participant_id
      setSelectedToParticipantId(balance.participant_id || member?.participant_id || balance.user_id);
      // Prefill whole amounts without .00, with grouping (matches share/remind copy)
      setAmount(
        formatShareAmountInput(
          Math.abs(balance.amount),
          balance.currency || effectiveDefaultCurrency,
        ),
      );
      setDate(toDateInputValue(null));
    } else if (isAdminMode) {
      if (initialAmount) {
        setAmount(
          formatShareAmountInput(initialAmount, effectiveDefaultCurrency),
        );
      }
      setSelectedFromParticipantId(fromParticipantId || "");
      setSelectedToParticipantId(toParticipantId || "");
      setDate(toDateInputValue(null));
    } else if (availableUsers.length > 0) {
      // Default to first available user
      setSelectedToParticipantId(availableUsers[0].participant_id || "");
      setDate(toDateInputValue(null));
    } else {
      setDate(toDateInputValue(null));
    }
  }, [
    visible,
    balance,
    settlement,
    availableUsers,
    currentUserId,
    isAdminMode,
    initialAmount,
    fromParticipantId,
    toParticipantId,
    groupMembers,
    effectiveDefaultCurrency,
  ]);

  const validateForm = (): boolean => {
    let isValid = true;

    // Validate amount (commas from share-style prefill are allowed)
    const amountNum = parseShareAmountInput(amount);
    if (amountNum == null || amountNum <= 0) {
      setAmountError("Please enter a valid amount greater than 0");
      isValid = false;
    } else {
      setAmountError("");
    }

    // Validate participant selection (for manual entry)
    if (!balance && !settlement && !isAdminMode && !selectedToParticipantId) {
      isValid = false;
    }

    if (isEditing) {
      if (!selectedFromParticipantId || !selectedToParticipantId) {
        isValid = false;
      } else if (selectedFromParticipantId === selectedToParticipantId) {
        Alert.alert("Error", "Payer and receiver must be different people");
        isValid = false;
      }
    }

    return isValid;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    const amountNum = parseShareAmountInput(amount);
    if (amountNum == null || amountNum <= 0) {
      return;
    }

    try {
      setLoading(true);

      // If editing, call onUpdate
      if (isEditing && settlement) {
        if (!onUpdate) {
          Alert.alert("Error", "Unable to update this settlement right now");
          return;
        }
        await onUpdate({
          id: settlement.id,
          group_id: settlement.group_id || groupId,
          amount: amountNum,
          currency: effectiveDefaultCurrency,
          notes: notes.trim() || undefined,
          from_participant_id: selectedFromParticipantId || undefined,
          to_participant_id: selectedToParticipantId || undefined,
          date: date || undefined,
        });
      } else if (isAdminMode) {
            // Explicit mode
            if (!fromParticipantId || !toParticipantId) return; // Should likely alert
            
            await onSave({
              group_id: groupId,
              from_participant_id: fromParticipantId,
              to_participant_id: toParticipantId,
              amount: amountNum,
              currency: effectiveDefaultCurrency,
              notes: notes.trim() || undefined,
            });
            
        } else {
             // Standard "Me vs Them" mode
             // Determine the current user's participant ID
            const currentMember = groupMembers.find(m => m.user_id === currentUserId);
            const currentParticipantId = currentMember?.participant_id;

            if (!currentParticipantId) {
            Alert.alert("Error", "Unable to identify your participant record in this group");
            return;
            }

            // Determine the other participant ID
            let otherParticipantId: string;
            if (balance) {
            const member = groupMembers.find(m => m.user_id === balance.user_id);
            // Prioritize the member's participant_id if found (since balance.participant_id might be the user_id)
            otherParticipantId = member?.participant_id || balance.participant_id || balance.user_id;
            } else if (selectedToParticipantId) {
            otherParticipantId = selectedToParticipantId;
            } else {
            Alert.alert("Error", "Please select a member to settle with");
            return;
            }

            if (!otherParticipantId) {
            Alert.alert("Error", "Selected member does not have a valid participant record");
            return;
            }

            // Determine from_participant_id and to_participant_id
            const fromId = isPaying ? currentParticipantId : otherParticipantId;
            const toId = isPaying ? otherParticipantId : currentParticipantId;

            await onSave({
            group_id: groupId,
            from_participant_id: fromId,
            to_participant_id: toId,
            amount: amountNum,
            currency: effectiveDefaultCurrency,
            notes: notes.trim() || undefined,
            });
        }


      // Reset form
      setAmount("");
      setNotes("");
      setDate("");
      setSelectedFromParticipantId("");
      setSelectedToParticipantId("");
      setAmountError("");
    } catch (error) {
      Alert.alert("Error", getUserFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const performDelete = async () => {
    if (!onDelete || !settlement) return;
    setShowDeleteConfirm(false);
    setLoading(true);
    try {
      await onDelete();
    } catch (error) {
      Alert.alert("Error", getUserFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (!onDelete || !settlement || loading) return;

    if (Platform.OS === "web") {
      setShowDeleteConfirm(true);
      return;
    }

    Alert.alert(
      "Delete Settlement",
      "Are you sure you want to delete this settlement? Balances will be recalculated. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void performDelete();
          },
        },
      ]
    );
  };

  const getParticipantDisplayName = (participantId: string): string => {
    // Prefer participants list (names/emails), else groupMembers — first name / email local-part
    const participant = participants.find((p: Participant) => p.id === participantId);
    if (participant) {
      return settleSharePersonName(participant);
    }
    const member = groupMembers.find((m) => m.participant_id === participantId);
    if (member) {
      return settleSharePersonName(member);
    }
    return `Member ${participantId.substring(0, 8)}`;
  };

  const headerFromId = isEditing
    ? selectedFromParticipantId
    : isAdminMode
    ? fromParticipantId
    : undefined;
  const headerToId = isEditing
    ? selectedToParticipantId
    : isAdminMode
    ? toParticipantId
    : undefined;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="pageSheet"
      testID="settlement-form-modal"
    >
      <View style={[styles.rootContainer, { backgroundColor: theme.colors.background }]}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={insets.top}
        >
          <Appbar.Header>
            <Appbar.Action icon="close" accessibilityLabel="Close settlement" onPress={onDismiss} testID="settlement-form-close" />
            <Appbar.Content title={isEditing ? "Edit settlement" : "Record settlement"} />
            {isEditing && onDelete ? (
              <Appbar.Action
                icon="delete-outline"
                onPress={handleDelete}
                iconColor={theme.colors.error}
                accessibilityLabel="Delete settlement"
                testID="delete-settlement-button"
              />
            ) : null}
          </Appbar.Header>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {!isEditing ? (
              <Text
                variant="bodyMedium"
                style={{
                  color: theme.colors.onSurfaceVariant,
                  marginBottom: 16,
                  paddingHorizontal: 4,
                }}
                testID="settle-outside-app-help"
              >
                {SETTLE_OUTSIDE_APP_HELP}
              </Text>
            ) : null}

            {/* Unified Settlement Header: Shows Who is Paying Who */}
            <View
              style={[
                styles.balanceInfo,
                { backgroundColor: theme.colors.surfaceVariant },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                {(() => {
                  let fromName = "";
                  let toName = "";

                  if (isEditing && headerFromId && headerToId) {
                    const currentMember = groupMembers.find(m => m.user_id === currentUserId);
                    const currentParticipantId = currentMember?.participant_id;
                    
                    fromName =
                      headerFromId === currentParticipantId
                        ? YOU_LABEL
                        : getParticipantDisplayName(headerFromId);
                    toName =
                      headerToId === currentParticipantId
                        ? YOU_LABEL
                        : getParticipantDisplayName(headerToId);
                  } else if (isAdminMode) {
                    fromName = adminPayer
                      ? settleSharePersonName(adminPayer)
                      : "Payer";
                    toName = adminReceiver
                      ? settleSharePersonName(adminReceiver)
                      : "Receiver";
                    if (adminPayer?.user_id === currentUserId) fromName = YOU_LABEL;
                    if (adminReceiver?.user_id === currentUserId) toName = YOU_LABEL;
                  } else if (balance) {
                    const counterparty = settleSharePersonName(balance);
                    if (isPaying) {
                      fromName = YOU_LABEL;
                      toName = counterparty;
                    } else {
                      fromName = counterparty;
                      toName = YOU_LABEL;
                    }
                  } else if (selectedToParticipantId) {
                     // Manual entry
                     fromName = YOU_LABEL;
                     const member = availableUsers.find(u => u.participant_id === selectedToParticipantId);
                     toName = member ? settleSharePersonName(member) : "Member";
                  } else {
                    return (
                      <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                        Choose who paid whom
                      </Text>
                    );
                  }

                  return (
                    <>
                      <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>
                        {fromName}
                      </Text>
                      <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 8 }}>
                        paid
                      </Text>
                      <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>
                        {toName}
                      </Text>
                    </>
                  );
                })()}
              </View>
              
              {(amount || isEditing || isAdminMode) && (
                <Text
                  variant="bodyMedium"
                  style={[
                    styles.balanceAmount,
                    { color: theme.colors.onSurfaceVariant, marginTop: 8 },
                  ]}
                >
                  {formatCurrency(
                    parseShareAmountInput(amount) ||
                      initialAmount ||
                      settlement?.amount ||
                      0,
                    effectiveDefaultCurrency
                  )}
                </Text>
              )}
            </View>

            {isEditing ? (
              <>
                <View style={styles.section}>
                  <Text variant="labelLarge" style={styles.label}>
                    From (payer)
                  </Text>
                  <View style={styles.chipWrap}>
                    {editableParticipants.map((participant) => {
                      const isSelected = selectedFromParticipantId === participant.id;
                      return (
                        <Chip
                          key={`from-${participant.id}`}
                          selected={isSelected}
                          onPress={() => setSelectedFromParticipantId(participant.id)}
                          disabled={loading}
                          showSelectedCheck
                          style={[
                            styles.wrapChip,
                            !isSelected && { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          theme={chipSelectionTheme}
                          testID={`settlement-from-${participant.id}`}
                        >
                          {participant.label}
                        </Chip>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.section}>
                  <Text variant="labelLarge" style={styles.label}>
                    To (receiver)
                  </Text>
                  <View style={styles.chipWrap}>
                    {editableParticipants.map((participant) => {
                      const isSelected = selectedToParticipantId === participant.id;
                      return (
                        <Chip
                          key={`to-${participant.id}`}
                          selected={isSelected}
                          onPress={() => setSelectedToParticipantId(participant.id)}
                          disabled={loading}
                          showSelectedCheck
                          style={[
                            styles.wrapChip,
                            !isSelected && { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          theme={chipSelectionTheme}
                          testID={`settlement-to-${participant.id}`}
                        >
                          {participant.label}
                        </Chip>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : null}

            {!isEditing && !balance && !isAdminMode && (
              <>
                <View style={styles.section}>
                  <Text variant="labelLarge" style={styles.label}>
                    From
                  </Text>
                  <TextInput
                    mode="outlined"
                    value="You"
                    accessibilityLabel="From (payer)"
                    editable={false}
                    right={<TextInput.Icon icon="account-outline" accessible={false} importantForAccessibility="no" />}
                    testID="settlement-from-you"
                  />
                </View>
                <View style={styles.section}>
                  <Text variant="labelLarge" style={styles.label}>
                    To
                  </Text>
                  <View style={styles.chipWrap}>
                    {availableUserList.map((member) => {
                      const isSelected = selectedToParticipantId === member.participant_id;
                      return (
                        <Chip
                          key={member.participant_id}
                          selected={isSelected}
                          onPress={() => setSelectedToParticipantId(member.participant_id || "")}
                          disabled={loading}
                          showSelectedCheck
                          style={[
                            styles.wrapChip,
                            !isSelected && { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          theme={chipSelectionTheme}
                          testID={`settlement-to-${member.participant_id}`}
                        >
                          {formatAvailableUserLabel(member)}
                        </Chip>
                      );
                    })}
                  </View>
                </View>
              </>
            )}

            <View style={styles.section}>
              <Text variant="labelLarge" style={styles.label}>
                Amount
              </Text>
              <TextInput
                label="Amount"
                value={amount}
                onChangeText={(text) => {
                  setAmount(text);
                  if (amountError) setAmountError("");
                }}
                keyboardType="decimal-pad"
                error={!!amountError}
                mode="outlined"
                placeholder="$ 0.00"
                testID="settlement-amount-input"
                accessibilityHint={amountError || undefined}
                left={
                  <TextInput.Affix
                    text={getCurrencySymbol(effectiveDefaultCurrency)}
                  />
                }
              />
              {amountError ? (
                <Text
                  variant="bodySmall"
                  accessibilityLiveRegion="polite"
                  style={[styles.errorText, { color: theme.colors.error }]}
                >
                  {amountError}
                </Text>
              ) : null}
            </View>

            {isEditing ? (
              <View style={styles.section}>
                <Text variant="labelLarge" style={styles.label}>
                  Date
                </Text>
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  testID="settlement-date-picker"
                  style={[
                    styles.dateButton,
                    {
                      borderColor: theme.colors.outline,
                      backgroundColor: theme.colors.surface,
                    },
                  ]}
                >
                  <Text variant="bodyLarge">{formatDateForDisplay(date)}</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text variant="labelLarge" style={styles.label}>
                Note
              </Text>
              <TextInput
                label="What's this payment for?"
                value={notes}
                onChangeText={setNotes}
                mode="outlined"
                multiline
                numberOfLines={3}
                placeholder="What's this payment for?"
                testID="settlement-notes-input"
              />
            </View>

            <View style={styles.buttonContainer}>
              <Button
                mode="contained"
                onPress={handleSave}
                loading={loading}
                disabled={
                  loading ||
                  !amount ||
                  (!isEditing && !isAdminMode && !selectedToParticipantId && !balance) ||
                  (isEditing &&
                    (!selectedFromParticipantId || !selectedToParticipantId))
                }
                style={[styles.saveButton, { borderRadius: 8 }]}
                icon={isEditing ? undefined : "arrow-right"}
                contentStyle={{ flexDirection: "row-reverse" }}
                testID="settlement-save-button"
              >
                {isEditing ? UPDATE_SETTLEMENT_LABEL : RECORD_SETTLEMENT_LABEL}
              </Button>
              {showRemind ? (
                <View style={styles.remindBlock}>
                  <Button
                    mode="text"
                    icon="share-variant"
                    compact
                    testID="settlement-remind-button"
                    accessibilityLabel={remindLabel || "Remind"}
                    accessibilityHint={
                      remindShareAnotherWay && onRemindShareAnotherWay
                        ? "Long press to share another way"
                        : undefined
                    }
                    onPress={onRemindPress}
                    onLongPress={
                      remindShareAnotherWay && onRemindShareAnotherWay
                        ? onRemindShareAnotherWay
                        : undefined
                    }
                    delayLongPress={350}
                    disabled={loading}
                    style={styles.remindButton}
                  >
                    {remindLabel || "Remind"}
                  </Button>
                  {remindShareAnotherWay && onRemindShareAnotherWay ? (
                    <Button
                      mode="text"
                      compact
                      testID="settlement-remind-share-another-way"
                      accessibilityLabel="Share another way"
                      onPress={onRemindShareAnotherWay}
                      disabled={loading}
                      style={styles.shareAnotherWayButton}
                      labelStyle={{ fontSize: 12 }}
                    >
                      Share another way
                    </Button>
                  ) : null}
                </View>
              ) : null}
              <Button
                mode="outlined"
                onPress={onDismiss}
                disabled={loading}
                style={styles.cancelButton}
              >
                Cancel
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {showDatePicker && Platform.OS === "ios" && (
          <Modal visible={showDatePicker} transparent animationType="slide">
            <View style={styles.datePickerOverlay}>
              <View
                style={[
                  styles.datePickerModal,
                  { backgroundColor: theme.colors.surface },
                ]}
              >
                <View style={styles.datePickerHeader}>
                  <Button onPress={() => setShowDatePicker(false)}>Done</Button>
                </View>
                <DateTimePicker
                  value={date ? new Date(`${date}T00:00:00`) : new Date()}
                  mode="date"
                  display="spinner"
                  onChange={(_event, selectedDate) => {
                    if (selectedDate) {
                      setDate(selectedDate.toISOString().split("T")[0]);
                    }
                  }}
                />
              </View>
            </View>
          </Modal>
        )}

        {showDatePicker && Platform.OS === "android" && (
          <DateTimePicker
            value={date ? new Date(`${date}T00:00:00`) : new Date()}
            mode="date"
            display="default"
            onChange={(event, selectedDate) => {
              setShowDatePicker(false);
              if (event.type === "set" && selectedDate) {
                setDate(selectedDate.toISOString().split("T")[0]);
              }
            }}
          />
        )}

        {showDatePicker && Platform.OS === "web" && (
          <Modal visible={showDatePicker} transparent animationType="slide">
            <View style={styles.datePickerOverlay}>
              <View
                style={[
                  styles.datePickerModal,
                  { backgroundColor: theme.colors.surface },
                ]}
              >
                <View style={styles.datePickerHeader}>
                  <Button onPress={() => setShowDatePicker(false)}>Done</Button>
                </View>
                <DateTimePicker
                  value={date ? new Date(`${date}T00:00:00`) : new Date()}
                  mode="date"
                  display="default"
                  onChange={(_event, selectedDate) => {
                    if (selectedDate) {
                      setDate(selectedDate.toISOString().split("T")[0]);
                    }
                  }}
                />
              </View>
            </View>
          </Modal>
        )}

        <Portal>
          <Dialog
            visible={showDeleteConfirm}
            onDismiss={() => setShowDeleteConfirm(false)}
            testID="delete-settlement-confirm-dialog"
          >
            <Dialog.Title>Delete Settlement</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">
                Are you sure you want to delete this settlement? Balances will be
                recalculated. This cannot be undone.
              </Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button
                onPress={() => setShowDeleteConfirm(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onPress={() => {
                  void performDelete();
                }}
                mode="contained"
                buttonColor={theme.colors.error}
                textColor={theme.colors.onError}
                loading={loading}
                disabled={loading}
                testID="confirm-delete-settlement-button"
              >
                Delete
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    width: "100%",
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  balanceInfo: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    alignItems: "center",
  },
  balanceText: {
    fontWeight: "600",
    marginBottom: 4,
  },
  balanceAmount: {
    // color removed, set via theme
  },
  section: {
    marginBottom: 24,
  },
  label: {
    marginBottom: 8,
    fontWeight: "600",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  wrapChip: {
    marginBottom: 4,
  },
  userPicker: {
    marginTop: 8,
  },
  userButton: {
    marginRight: 8,
  },
  errorText: {
    marginTop: 4,
  },
  buttonContainer: {
    marginTop: 8,
    marginBottom: 24,
  },
  saveButton: {
    marginBottom: 4,
  },
  remindBlock: {
    alignItems: "center",
    marginBottom: 4,
  },
  remindButton: {
    alignSelf: "center",
  },
  shareAnotherWayButton: {
    alignSelf: "center",
    marginTop: -4,
  },
  cancelButton: {
    marginTop: 4,
  },
  dateButton: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  datePickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  datePickerModal: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  datePickerHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingTop: 8,
  },
});
