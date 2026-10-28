import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    AppState,
    Clipboard,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import { Appbar, Button, Chip, Dialog, Portal, Text, TextInput, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { UpiQrCode } from "../components/UpiQrCode";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useUserProfiles } from "../hooks/useUserProfiles";
import { Balance, GroupMember, Participant, Settlement } from "../types";
import {
    getCurrencySymbol,
    getDefaultCurrency,
} from "../utils/currency";
import { getUserFriendlyErrorMessage } from "../utils/errorMessages";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import {
  COPY_UPI_ID_LABEL,
  formatDidYouPayQuestion,
  formatPayeeUpiLine,
  NOT_YET_LABEL,
  PAY_VIA_UPI_LABEL,
  RECORD_SETTLEMENT_LABEL,
  SETTLE_OUTSIDE_APP_HELP,
  UPDATE_SETTLEMENT_LABEL,
  YES_RECORD_IT_LABEL,
} from "../utils/settleCopy";
import {
  formatShareAmountInput,
  formatShareCurrency,
  parseShareAmountInput,
  settleModalPersonName,
  settleModalYouLabel,
} from "../utils/settleShareMessage";
import {
  settlementCounterpartyDisplayName,
  type SettlementPresence,
} from "../utils/settlementPresence";
import {
  buildUpiAppPayUri,
  buildUpiPayUri,
  isDesktopWebUpiSurface,
  needsUpiAppPicker,
  normalizeUpiId,
  type UpiAppDefinition,
  type UpiPayUriInput,
} from "../utils/upi";
import { detectInstalledUpiApps } from "../utils/upiApps";

type UpiPhase = "idle" | "awaiting_return" | "confirm";

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
  /** Group display name for UPI `tn` note (`SharedMoney · {group}`). */
  groupName?: string;
  /**
   * @deprecated Presence chrome lives on the group settle row only — the modal
   * header is a single sentence with no suffix. Kept optional for call-site compat.
   */
  counterpartyPresence?: SettlementPresence;
  /** Design-review only: force payee VPA (skips profile fetch when set). */
  previewPayeeUpiId?: string | null;
  /** Design-review only: force post-UPI confirm / awaiting state. */
  previewUpiPhase?: UpiPhase;
  /** Design-review only: open the iOS app picker. */
  previewShowUpiAppPicker?: boolean;
  /** Design-review only: apps listed in the picker. */
  previewInstalledUpiApps?: UpiAppDefinition[];
  /** Design-review only: render desktop web QR + Copy surface. */
  previewForceDesktopWeb?: boolean;
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

function participantLabelBase(
  item: { id: string; full_name?: string | null; email?: string | null },
): string {
  const name = item.full_name?.trim();
  if (name) return name;
  const local = item.email?.includes("@")
    ? item.email.split("@")[0]?.trim()
    : null;
  if (local) return local;
  return `Member ${item.id.substring(0, 8)}`;
}

function formatParticipantLabel(
  item: { id: string; user_id?: string | null; full_name?: string | null; email?: string | null },
  all: Array<{ id: string; user_id?: string | null; full_name?: string | null; email?: string | null }>,
  currentUserId?: string
): string {
  // Never surface a raw email in this modal — name as entered, else local-part.
  const labelBase = participantLabelBase(item);
  const duplicates = all.filter(
    (other) =>
      participantLabelBase(other).toLowerCase() === labelBase.toLowerCase(),
  );
  // Disambiguate with id fragment — never append the full email.
  const base = duplicates.length > 1
    ? `${labelBase} · ${item.id.substring(0, 8)}`
    : labelBase;
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
  groupName,
  previewPayeeUpiId,
  previewUpiPhase,
  previewShowUpiAppPicker,
  previewInstalledUpiApps,
  previewForceDesktopWeb = false,
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
  const [upiCopied, setUpiCopied] = useState(false);
  const [upiPhase, setUpiPhase] = useState<UpiPhase>(
    previewUpiPhase ?? "idle",
  );
  const [showUpiAppPicker, setShowUpiAppPicker] = useState(
    !!previewShowUpiAppPicker,
  );
  const [installedUpiApps, setInstalledUpiApps] = useState<UpiAppDefinition[]>(
    previewInstalledUpiApps ?? [],
  );
  const [upiAppsLoading, setUpiAppsLoading] = useState(false);
  const launchedUpiRef = useRef(false);

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

  const isInrSettle = effectiveDefaultCurrency.toUpperCase() === "INR";
  const webUserAgent =
    Platform.OS === "web" && typeof navigator !== "undefined"
      ? navigator.userAgent
      : undefined;
  // Design preview: default to mobile Pay via UPI CTA; only
  // previewForceDesktopWeb opts into QR + Copy (desktop web).
  const inUpiDesignPreview = previewPayeeUpiId !== undefined;
  const desktopWebUpi = previewForceDesktopWeb
    ? true
    : inUpiDesignPreview
      ? false
      : isDesktopWebUpiSurface(Platform.OS, webUserAgent);
  const iosUpiPicker = previewShowUpiAppPicker
    ? true
    : inUpiDesignPreview
      ? false
      : needsUpiAppPicker(Platform.OS);

  const payeeUserId = useMemo(() => {
    if (isEditing || !isPaying) return null;
    if (balance?.user_id) return balance.user_id;
    const targetParticipantId = toParticipantId || selectedToParticipantId;
    if (!targetParticipantId) return null;
    const member = groupMembers.find(
      (m) => m.participant_id === targetParticipantId,
    );
    if (member?.user_id) return member.user_id;
    const person = participants.find((p) => p.id === targetParticipantId);
    return person?.user_id || null;
  }, [
    isEditing,
    isPaying,
    balance?.user_id,
    toParticipantId,
    selectedToParticipantId,
    groupMembers,
    participants,
  ]);

  const shouldFetchPayeeUpi =
    previewPayeeUpiId === undefined &&
    visible &&
    isInrSettle &&
    !!payeeUserId;
  const payeeProfilesQuery = useUserProfiles(
    shouldFetchPayeeUpi && payeeUserId ? [payeeUserId] : [],
  );
  const payeeUpiId = useMemo(() => {
    if (previewPayeeUpiId !== undefined) {
      return normalizeUpiId(previewPayeeUpiId);
    }
    if (!payeeUserId) return null;
    return normalizeUpiId(
      payeeProfilesQuery.data.get(payeeUserId)?.upi_id ?? null,
    );
  }, [previewPayeeUpiId, payeeUserId, payeeProfilesQuery.data]);

  const payeeDisplayName = useMemo(() => {
    if (balance) {
      return settlementCounterpartyDisplayName(balance, participants);
    }
    const targetParticipantId = toParticipantId || selectedToParticipantId;
    const member = groupMembers.find(
      (m) => m.participant_id === targetParticipantId,
    );
    if (member) return settleModalPersonName(member);
    const person = participants.find((p) => p.id === targetParticipantId);
    if (person) return settleModalPersonName(person);
    return "Member";
  }, [
    balance,
    participants,
    toParticipantId,
    selectedToParticipantId,
    groupMembers,
  ]);

  const effectiveUpiPhase = previewUpiPhase ?? upiPhase;
  const showUpiSkeleton =
    !isEditing &&
    isPaying &&
    isInrSettle &&
    !!payeeUserId &&
    previewPayeeUpiId === undefined &&
    payeeProfilesQuery.isLoading;
  const showPayViaUpi =
    !isEditing &&
    isPaying &&
    isInrSettle &&
    !!payeeUpiId &&
    effectiveUpiPhase !== "confirm";
  const showingConfirm =
    !isEditing && isPaying && isInrSettle && effectiveUpiPhase === "confirm";

  const upiPayInput = useMemo((): UpiPayUriInput | null => {
    if (!payeeUpiId) return null;
    const amountNum = parseShareAmountInput(amount);
    if (amountNum == null || amountNum <= 0) return null;
    return {
      vpa: payeeUpiId,
      payeeName: payeeDisplayName,
      amount: amountNum,
      groupName: groupName || "group",
    };
  }, [payeeUpiId, amount, payeeDisplayName, groupName]);

  const desktopUpiUri = useMemo(() => {
    if (!desktopWebUpi || !upiPayInput) return null;
    try {
      return buildUpiPayUri(upiPayInput);
    } catch {
      return null;
    }
  }, [desktopWebUpi, upiPayInput]);

  const confirmAmountLabel = useMemo(() => {
    const amountNum = parseShareAmountInput(amount);
    if (amountNum == null) {
      return formatShareCurrency(0, effectiveDefaultCurrency);
    }
    return formatShareCurrency(amountNum, effectiveDefaultCurrency);
  }, [amount, effectiveDefaultCurrency]);

  useEffect(() => {
    if (!visible) {
      setUpiCopied(false);
      setUpiPhase("idle");
      setShowUpiAppPicker(false);
      setInstalledUpiApps([]);
      launchedUpiRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (previewShowUpiAppPicker) {
      setShowUpiAppPicker(true);
      if (previewInstalledUpiApps) {
        setInstalledUpiApps(previewInstalledUpiApps);
        setUpiAppsLoading(false);
      }
    }
  }, [previewShowUpiAppPicker, previewInstalledUpiApps]);

  useEffect(() => {
    if (upiPhase !== "awaiting_return") return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && launchedUpiRef.current) {
        launchedUpiRef.current = false;
        setUpiPhase("confirm");
      }
    });
    return () => sub.remove();
  }, [upiPhase]);

  const copyPayeeUpiId = () => {
    if (!payeeUpiId) return;
    Clipboard.setString(payeeUpiId);
    setUpiCopied(true);
    captureIdentifiedAnalyticsEvent(
      currentUserId,
      ANALYTICS_EVENTS.UPI_PAY_TAPPED,
      {
        currency: "INR",
        platform: Platform.OS,
        mode: "copy",
        group_id: groupId,
      },
    );
  };

  const launchUpiUri = async (uri: string, mode: string) => {
    captureIdentifiedAnalyticsEvent(
      currentUserId,
      ANALYTICS_EVENTS.UPI_PAY_TAPPED,
      {
        currency: "INR",
        platform: Platform.OS,
        mode,
        group_id: groupId,
      },
    );
    launchedUpiRef.current = true;
    setUpiPhase("awaiting_return");
    try {
      await Linking.openURL(uri);
    } catch {
      launchedUpiRef.current = false;
      setUpiPhase("idle");
      Alert.alert(
        "Could not open UPI",
        "Open your UPI app and pay manually, then come back to record it.",
      );
    }
  };

  const launchGenericUpi = async () => {
    if (!upiPayInput) {
      setAmountError("Please enter a valid amount greater than 0");
      return;
    }
    try {
      await launchUpiUri(buildUpiPayUri(upiPayInput), "deep_link");
    } catch {
      setAmountError("Please enter a valid amount greater than 0");
    }
  };

  const launchUpiApp = async (app: UpiAppDefinition) => {
    if (!upiPayInput) {
      setAmountError("Please enter a valid amount greater than 0");
      return;
    }
    setShowUpiAppPicker(false);
    try {
      await launchUpiUri(buildUpiAppPayUri(app, upiPayInput), `app_${app.id}`);
    } catch {
      setAmountError("Please enter a valid amount greater than 0");
    }
  };

  const handlePayViaUpi = async () => {
    if (!payeeUpiId) return;
    const amountNum = parseShareAmountInput(amount);
    if (amountNum == null || amountNum <= 0) {
      setAmountError("Please enter a valid amount greater than 0");
      return;
    }
    if (desktopWebUpi) {
      copyPayeeUpiId();
      return;
    }
    if (iosUpiPicker) {
      setUpiAppsLoading(true);
      setShowUpiAppPicker(true);
      try {
        const apps = await detectInstalledUpiApps();
        setInstalledUpiApps(apps);
      } finally {
        setUpiAppsLoading(false);
      }
      return;
    }
    await launchGenericUpi();
  };

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
      setUpiPhase("idle");
      setShowUpiAppPicker(false);
      setUpiCopied(false);
      launchedUpiRef.current = false;
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
    // Prefer participants list, else groupMembers — full name as entered / email local-part
    const participant = participants.find((p: Participant) => p.id === participantId);
    if (participant) {
      return settleModalPersonName(participant);
    }
    const member = groupMembers.find((m) => m.participant_id === participantId);
    if (member) {
      return settleModalPersonName(member);
    }
    return `Member ${participantId.substring(0, 8)}`;
  };

  const reformatAmountOnBlur = () => {
    const parsed = parseShareAmountInput(amount);
    if (parsed == null) return;
    setAmount(formatShareAmountInput(parsed, effectiveDefaultCurrency));
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
              <View style={{ width: "100%" }}>
                {(() => {
                  let fromName = "";
                  let toName = "";

                  if (isEditing && headerFromId && headerToId) {
                    const currentMember = groupMembers.find(m => m.user_id === currentUserId);
                    const currentParticipantId = currentMember?.participant_id;
                    
                    fromName =
                      headerFromId === currentParticipantId
                        ? settleModalYouLabel("from")
                        : getParticipantDisplayName(headerFromId);
                    toName =
                      headerToId === currentParticipantId
                        ? settleModalYouLabel("to")
                        : getParticipantDisplayName(headerToId);
                  } else if (isAdminMode) {
                    fromName = adminPayer
                      ? settleModalPersonName(adminPayer)
                      : "Payer";
                    toName = adminReceiver
                      ? settleModalPersonName(adminReceiver)
                      : "Receiver";
                    if (adminPayer?.user_id === currentUserId) {
                      fromName = settleModalYouLabel("from");
                    }
                    if (adminReceiver?.user_id === currentUserId) {
                      toName = settleModalYouLabel("to");
                    }
                  } else if (balance) {
                    // Prefer participants list (typed name for people without accounts).
                    const counterparty = settlementCounterpartyDisplayName(
                      balance,
                      participants,
                    );
                    if (isPaying) {
                      fromName = settleModalYouLabel("from");
                      toName = counterparty;
                    } else {
                      fromName = counterparty;
                      toName = settleModalYouLabel("to");
                    }
                  } else if (selectedToParticipantId) {
                     // Manual entry
                     fromName = settleModalYouLabel("from");
                     const member = availableUsers.find(u => u.participant_id === selectedToParticipantId);
                     toName = member ? settleModalPersonName(member) : "Member";
                  } else {
                    return (
                      <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                        Choose who paid whom
                      </Text>
                    );
                  }

                  const fromIsYou = fromName === settleModalYouLabel("from");
                  const toIsYou = toName === settleModalYouLabel("to");

                  // Single sentence — no presence suffix (that lives on the group row).
                  return (
                    <View
                      style={styles.paidHeaderRow}
                      testID="settlement-paid-header"
                    >
                      <Text
                        variant="titleMedium"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{
                          color: theme.colors.onSurface,
                          fontWeight: "bold",
                          flexShrink: fromIsYou ? 0 : 1,
                          flexGrow: 0,
                          minWidth: fromIsYou ? undefined : 0,
                        }}
                        testID="settlement-paid-from"
                      >
                        {fromName}
                      </Text>
                      <Text
                        variant="titleMedium"
                        style={{
                          color: theme.colors.onSurfaceVariant,
                          marginHorizontal: 8,
                          flexShrink: 0,
                          flexGrow: 0,
                        }}
                      >
                        paid
                      </Text>
                      <Text
                        variant="titleMedium"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{
                          color: theme.colors.onSurface,
                          fontWeight: "bold",
                          flexShrink: toIsYou ? 0 : 1,
                          flexGrow: 0,
                          minWidth: toIsYou ? undefined : 0,
                        }}
                        testID="settlement-paid-to"
                      >
                        {toName}
                      </Text>
                    </View>
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
                  testID="settlement-header-amount"
                >
                  {formatShareCurrency(
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

            {showingConfirm ? (
              <View
                style={styles.buttonContainer}
                testID="settlement-upi-confirm"
              >
                <Text
                  variant="titleMedium"
                  style={[
                    styles.confirmQuestion,
                    { color: theme.colors.onSurface },
                  ]}
                  testID="settlement-upi-confirm-question"
                >
                  {formatDidYouPayQuestion(payeeDisplayName, confirmAmountLabel)}
                </Text>
                <Button
                  mode="contained"
                  onPress={handleSave}
                  loading={loading}
                  disabled={loading || !amount}
                  style={[styles.saveButton, { borderRadius: 8 }]}
                  testID="settlement-upi-confirm-yes"
                  accessibilityLabel={YES_RECORD_IT_LABEL}
                >
                  {YES_RECORD_IT_LABEL}
                </Button>
                <Button
                  mode="text"
                  onPress={() => setUpiPhase("idle")}
                  disabled={loading}
                  style={styles.notYetButton}
                  testID="settlement-upi-confirm-not-yet"
                  accessibilityLabel={NOT_YET_LABEL}
                >
                  {NOT_YET_LABEL}
                </Button>
                <Button
                  mode="outlined"
                  onPress={onDismiss}
                  disabled={loading}
                  style={styles.cancelButton}
                >
                  Cancel
                </Button>
              </View>
            ) : (
              <>
            <View style={styles.section}>
              <Text variant="labelLarge" style={styles.label}>
                Amount
              </Text>
              <TextInput
                label="Amount"
                value={amount}
                onChangeText={(text) => {
                  // Do not reformat per keystroke (cursor jump); commas stripped on parse/blur.
                  setAmount(text);
                  if (amountError) setAmountError("");
                }}
                onBlur={reformatAmountOnBlur}
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
              {showPayViaUpi && payeeUpiId ? (
                <Text
                  variant="bodySmall"
                  style={[
                    styles.payeeUpiLine,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  testID="settlement-payee-upi-line"
                >
                  {formatPayeeUpiLine(payeeDisplayName, payeeUpiId)}
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
              {showUpiSkeleton ? (
                <SkeletonGroup
                  style={styles.upiSkeleton}
                  testID="settlement-upi-skeleton"
                >
                  <Skeleton width="100%" height={48} borderRadius={8} />
                </SkeletonGroup>
              ) : null}
              {showPayViaUpi && !desktopWebUpi ? (
                <Button
                  mode="contained"
                  onPress={() => {
                    void handlePayViaUpi();
                  }}
                  disabled={loading || !amount}
                  style={[styles.saveButton, { borderRadius: 8 }]}
                  icon="contactless-payment"
                  testID="settlement-pay-via-upi-button"
                  accessibilityLabel={PAY_VIA_UPI_LABEL}
                >
                  {PAY_VIA_UPI_LABEL}
                </Button>
              ) : null}
              {showPayViaUpi && desktopWebUpi ? (
                <View
                  style={[
                    styles.upiDesktopBlock,
                    { borderColor: theme.colors.outline },
                  ]}
                  testID="settlement-upi-desktop-copy"
                >
                  {desktopUpiUri ? (
                    <UpiQrCode value={desktopUpiUri} size={160} />
                  ) : null}
                  <View style={styles.upiDesktopCopy}>
                    <Text
                      variant="labelLarge"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      UPI ID
                    </Text>
                    <Text
                      variant="titleMedium"
                      selectable
                      style={{ color: theme.colors.onSurface }}
                      testID="settlement-upi-id-value"
                    >
                      {payeeUpiId}
                    </Text>
                    <Button
                      mode="contained"
                      compact
                      onPress={copyPayeeUpiId}
                      disabled={loading}
                      style={{ borderRadius: 8, alignSelf: "flex-start", marginTop: 8 }}
                      testID="settlement-upi-copy-button"
                      accessibilityLabel={upiCopied ? "Copied" : COPY_UPI_ID_LABEL}
                    >
                      {upiCopied ? "Copied" : "Copy"}
                    </Button>
                  </View>
                </View>
              ) : null}
              {showPayViaUpi ? (
                <Button
                  mode="text"
                  onPress={handleSave}
                  loading={loading}
                  disabled={
                    loading ||
                    !amount ||
                    (!isEditing && !isAdminMode && !selectedToParticipantId && !balance)
                  }
                  style={styles.quietRecordButton}
                  testID="settlement-save-button"
                  accessibilityLabel={RECORD_SETTLEMENT_LABEL}
                >
                  {RECORD_SETTLEMENT_LABEL}
                </Button>
              ) : (
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
                  contentStyle={
                    isEditing ? undefined : { flexDirection: "row-reverse" }
                  }
                  testID="settlement-save-button"
                >
                  {isEditing ? UPDATE_SETTLEMENT_LABEL : RECORD_SETTLEMENT_LABEL}
                </Button>
              )}
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
              </>
            )}
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

        {/* Nested Modal (not Portal Dialog) so the picker paints above the
            settle sheet on web and in Design preview screenshots. */}
        <Modal
          visible={showUpiAppPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowUpiAppPicker(false)}
        >
          <View style={styles.upiPickerOverlay}>
            <View
              style={[
                styles.upiPickerSheet,
                { backgroundColor: theme.colors.surface },
              ]}
              testID="settlement-upi-app-picker"
            >
              <Text
                variant="titleMedium"
                style={[styles.upiPickerTitle, { color: theme.colors.onSurface }]}
              >
                Pay with
              </Text>
              {upiAppsLoading ? (
                <SkeletonGroup testID="settlement-upi-apps-skeleton">
                  <Skeleton width="100%" height={44} borderRadius={8} />
                  <View style={{ height: 8 }} />
                  <Skeleton width="100%" height={44} borderRadius={8} />
                </SkeletonGroup>
              ) : installedUpiApps.length > 0 ? (
                installedUpiApps.map((app) => (
                  <Button
                    key={app.id}
                    mode="outlined"
                    onPress={() => {
                      void launchUpiApp(app);
                    }}
                    style={styles.upiAppRow}
                    testID={`settlement-upi-app-${app.id}`}
                  >
                    {app.label}
                  </Button>
                ))
              ) : (
                <View>
                  <Text
                    variant="bodyMedium"
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      marginBottom: 12,
                    }}
                  >
                    No UPI apps found on this device. Copy the UPI ID and pay in your app.
                  </Text>
                  <Button
                    mode="contained"
                    onPress={() => {
                      setShowUpiAppPicker(false);
                      copyPayeeUpiId();
                    }}
                    style={{ borderRadius: 8 }}
                    testID="settlement-upi-picker-copy"
                  >
                    {COPY_UPI_ID_LABEL}
                  </Button>
                </View>
              )}
              <Button
                mode="text"
                onPress={() => setShowUpiAppPicker(false)}
                style={{ marginTop: 8 }}
                testID="settlement-upi-picker-cancel"
              >
                Cancel
              </Button>
            </View>
          </View>
        </Modal>

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
  paidHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "nowrap",
    width: "100%",
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
  upiSkeleton: {
    marginBottom: 8,
  },
  payeeUpiLine: {
    marginTop: 8,
  },
  upiDesktopBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  upiDesktopCopy: {
    flex: 1,
    gap: 2,
  },
  quietRecordButton: {
    alignSelf: "center",
    marginBottom: 4,
  },
  confirmQuestion: {
    textAlign: "center",
    fontWeight: "600",
    marginBottom: 16,
  },
  notYetButton: {
    alignSelf: "center",
    marginBottom: 4,
  },
  upiAppRow: {
    marginBottom: 8,
    borderRadius: 8,
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
