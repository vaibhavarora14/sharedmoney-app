import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    BackHandler,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    TextInput as RNTextInput,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from "react-native";
import {
    Appbar,
    Button,
    Card,
    Chip,
    Divider,
    IconButton,
    Searchbar,
    Surface,
    Text,
    TextInput,
    useTheme,
} from "react-native-paper";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ConvertedAmountHint } from "../components/ConvertedAmountHint";
import { ExchangeRateEditor } from "../components/ExchangeRateEditor";
import { SplitAmongEditor, SplitMode } from "../components/SplitAmongEditor";
import { TransactionWebDateField } from "../components/TransactionWebDateField";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencyPreferences } from "../hooks/useCurrencyPreferences";
import { useParticipants } from "../hooks/useParticipants";
import { useGroupLastExpenseSplitAmong } from "../hooks/useTransactions";
import { Participant, Transaction } from "../types";
import {
    filterCurrencies,
    getCurrencySymbol,
    getDefaultCurrency,
} from "../utils/currency";
import { convertAmount, resolveRate } from "../utils/currencyMerge";
import { getUserFriendlyErrorMessage } from "../utils/errorMessages";
import { intersectSplitAmongWithAvailable } from "../utils/groupSplit";
import { getWebHeroAmountInputWidth } from "../utils/heroAmountLayout";
import {
    amountsFromShares,
    calculateEqualSplits,
    calculateShareSplits,
    defaultShareMap,
    distributeRemaining,
    equalSplitAmountMap,
    formatAmountInput,
    isUnequalSplit,
    remainingSplitAmount,
    sharesAreUnequal,
    splitsFromAmountMap,
    sumSelectedAmounts,
} from "../utils/splits";

interface TransactionFormScreenProps {
  transaction?: Transaction | null;
  onSave: (
    transaction: Omit<Transaction, "id" | "created_at" | "user_id">
  ) => Promise<void>;
  onDismiss: () => void;
  onDelete?: () => Promise<void>;
  defaultCurrency?: string;
  defaultSplitAmong?: string[];
  groupId?: string;
}

const CATEGORY_OPTIONS = [
  { label: "Food", value: "Food", icon: "silverware-fork-knife" },
  { label: "Travel", value: "Travel", icon: "airplane" },
  { label: "Groceries", value: "Groceries", icon: "cart-outline" },
  { label: "Transport", value: "Transport", icon: "taxi" },
  { label: "Entertainment", value: "Entertainment", icon: "movie-open-outline" },
  { label: "Shopping", value: "Shopping", icon: "shopping-outline" },
  { label: "Rent", value: "Rent", icon: "home-outline" },
  { label: "Utilities", value: "Utilities", icon: "lightning-bolt-outline" },
  { label: "Health", value: "Health", icon: "medical-bag" },
  { label: "Other", value: "Other", icon: "tag-outline" },
] as const;

const isPresetCategory = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return CATEGORY_OPTIONS.some((option) => option.value.toLowerCase() === normalized);
};

const getCategoryDisplayLabel = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return CATEGORY_OPTIONS.find((option) => option.value.toLowerCase() === normalized)?.label || value.trim();
};

export const TransactionFormScreen: React.FC<TransactionFormScreenProps> = ({
  transaction,
  onSave,
  onDismiss,
  onDelete,
  defaultCurrency,
  defaultSplitAmong,
  groupId,
}) => {
  const effectiveDefaultCurrency = defaultCurrency || getDefaultCurrency();
  const theme = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const amountInputRef = useRef<RNTextInput>(null);
  const didDefaultSplitRef = useRef(false);

  // Form state
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [heroAmountWidth, setHeroAmountWidth] = useState(0);
  const [date, setDate] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [category, setCategory] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [useCustomCategoryInput, setUseCustomCategoryInput] = useState(false);
  const [currency, setCurrency] = useState<string>(effectiveDefaultCurrency);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [showRateEditor, setShowRateEditor] = useState(false);
  const {
    groupSettings,
    rateBook,
    setGroupRate,
    clearGroupRate,
  } = useCurrencyPreferences(groupId);
  const settlementCurrency = groupSettings?.settlementCurrency;
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [paidBy, setPaidBy] = useState<string>("");
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [splitShares, setSplitShares] = useState<Record<string, number>>({});
  const [showPaidByPicker, setShowPaidByPicker] = useState(false);

  // Error states
  const [descriptionError, setDescriptionError] = useState<string>("");
  const [amountError, setAmountError] = useState<string>("");
  const [dateError, setDateError] = useState<string>("");
  const [paidByError, setPaidByError] = useState<string>("");
  const [splitAmongError, setSplitAmongError] = useState<string>("");

  // Fetch participants
  const {
    data: participants,
    isLoading: isLoadingParticipants,
    error: participantsError,
  } = useParticipants(groupId || null);
  const lastExpenseSplitQuery = useGroupLastExpenseSplitAmong(
    transaction || !groupId ? null : groupId
  );

  // Memoized values
  const isGroupExpense = useMemo(
    () => type === "expense" && !!groupId && (participants?.length || 0) > 0,
    [type, groupId, participants?.length]
  );

  const activeParticipants = useMemo(
    () => (participants || []).filter((p) => p.type !== "former"),
    [participants]
  );

  const availableParticipants = useMemo(() => {
    const combined = [...activeParticipants];
    if (transaction) {
      // 1. Check payer
      if (transaction.paid_by_participant_id) {
        if (!combined.some(c => c.id === transaction.paid_by_participant_id)) {
          // Find the payer in the full participants list or reconstruct
          const p = (participants || []).find(p => p.id === transaction.paid_by_participant_id);
          if (p) {
            combined.push(p);
          }
        }
      }
      // 2. Check all split members
      if (Array.isArray(transaction.splits)) {
        transaction.splits.forEach(split => {
          if (split.participant_id && !combined.some(c => c.id === split.participant_id)) {
            const p = (participants || []).find(p => p.id === split.participant_id) || split.participant;
            if (p) {
              combined.push(p as Participant);
            }
          }
        });
      }
    }

    // Also ensure current paidBy is included if not already
    if (paidBy && !combined.some(c => c.id === paidBy)) {
      const p = (participants || []).find(p => p.id === paidBy);
      if (p) combined.push(p);
    }
    
    return combined;
  }, [activeParticipants, transaction, paidBy, participants]);

  const allParticipantIds = useMemo(
    () => availableParticipants.map((p) => p.id),
    [availableParticipants]
  );

  const areAllParticipantsSelected = useMemo(() => {
    return availableParticipants.length > 0 && availableParticipants.every((p) => splitAmong.includes(p.id));
  }, [availableParticipants, splitAmong]);

  const paidByParticipant = useMemo(
    () => paidBy ? availableParticipants.find((p) => p.id === paidBy) : undefined,
    [availableParticipants, paidBy]
  );

  // Use inline chips if 5 or fewer participants
  const useInlineChipsForPaidBy = availableParticipants.length <= 5;

  // Helper functions
  const resetFormToDefaults = useCallback(() => {
    const today = new Date();
    setDescription("");
    setAmount("");
    setDate(today.toISOString().split("T")[0]);
    setSelectedDate(today);
    setType("expense");
    setCategory("");
    setShowCategoryPicker(false);
    setUseCustomCategoryInput(false);
    setCurrency(effectiveDefaultCurrency);
    setPaidBy("");
    setSplitAmong([]);
    setSplitMode("equal");
    setSplitAmounts({});
    setSplitShares({});
    didDefaultSplitRef.current = false;
    setDescriptionError("");
    setAmountError("");
    setDateError("");
    setPaidByError("");
    setSplitAmongError("");
  }, [effectiveDefaultCurrency]);

  const loadTransactionData = useCallback(
    (tx: Transaction) => {
      setDescription(tx.description || "");
      setAmount(tx.amount.toString());
      const transactionDate = tx.date ? new Date(tx.date) : new Date();
      setSelectedDate(transactionDate);
      setDate(tx.date || "");
      setType(tx.type || "expense");
      const nextCategory = tx.category || "";
      setCategory(nextCategory);
      setUseCustomCategoryInput(!!nextCategory && !isPresetCategory(nextCategory));
      setCurrency(tx.currency || effectiveDefaultCurrency);

      if (tx.paid_by_participant_id) {
        setPaidBy(tx.paid_by_participant_id);
      } else {
        setPaidBy("");
      }

      if (Array.isArray(tx.splits) && tx.splits.length > 0) {
        const participantIds = tx.splits
          .map((s) => s.participant_id)
          .filter((id): id is string => !!id);
        const uniqueIds = [...new Set(participantIds)];
        const amountMap: Record<string, string> = {};
        tx.splits.forEach((split) => {
          if (split.participant_id) {
            amountMap[split.participant_id] = formatAmountInput(split.amount);
          }
        });
        setSplitAmong(uniqueIds);
        setSplitAmounts(amountMap);
        setSplitShares(defaultShareMap(uniqueIds));
        setSplitMode(isUnequalSplit(tx.splits) ? "unequal" : "equal");
      } else if (Array.isArray(tx.split_among_participant_ids) && tx.split_among_participant_ids.length > 0) {
        const uniqueIds = [...new Set(tx.split_among_participant_ids)];
        setSplitAmong(uniqueIds);
        setSplitAmounts({});
        setSplitShares(defaultShareMap(uniqueIds));
        setSplitMode("equal");
      } else {
        setSplitAmong([]);
        setSplitAmounts({});
        setSplitShares({});
        setSplitMode("equal");
      }
      didDefaultSplitRef.current = true;
    },
    [effectiveDefaultCurrency]
  );

  // Handle loading transaction data for editing
  useEffect(() => {
    if (transaction) {
      loadTransactionData(transaction);
    }
  }, [transaction?.id, loadTransactionData]);

  // Handle resetting form to defaults for new transactions
  useEffect(() => {
    if (!transaction) {
      resetFormToDefaults();
    }
  }, [transaction?.id, resetFormToDefaults]); 


  useEffect(() => {
    if (transaction) return;
    if (!isGroupExpense) {
      setSplitAmong([]);
      setSplitMode("equal");
      setSplitAmounts({});
      setSplitShares({});
      setPaidBy("");
      didDefaultSplitRef.current = false;
    } else {
      // For a new group expense, default split to the last expense's people once.
      // After that, an empty selection is an intentional user state and should remain empty.
      if (!didDefaultSplitRef.current && splitAmong.length === 0 && allParticipantIds.length > 0) {
        const rememberedSource =
          (defaultSplitAmong && defaultSplitAmong.length > 0)
            ? defaultSplitAmong
            : lastExpenseSplitQuery.data;
        const rememberedIds = intersectSplitAmongWithAvailable(
          rememberedSource,
          allParticipantIds,
        );
        if (rememberedIds.length > 0) {
          setSplitAmong(rememberedIds);
          setSplitShares(defaultShareMap(rememberedIds));
          didDefaultSplitRef.current = true;
          return;
        }

        const lastSplitResolved =
          lastExpenseSplitQuery.isFetched
          || lastExpenseSplitQuery.isError
          || !groupId
          || Boolean(defaultSplitAmong && defaultSplitAmong.length > 0);
        if (!lastSplitResolved) return;

        setSplitAmong(allParticipantIds);
        setSplitShares(defaultShareMap(allParticipantIds));
        didDefaultSplitRef.current = true;
      }
      
      // Default "Paid By" to the current user
      if (!paidBy && user && participants) {
        const currentUserParticipant = participants.find(p => p.user_id === user.id);
        if (currentUserParticipant) {
          setPaidBy(currentUserParticipant.id);
        }
      }
    }
  }, [
    isGroupExpense,
    transaction,
    allParticipantIds,
    splitAmong.length,
    user,
    participants,
    paidBy,
    defaultSplitAmong,
    lastExpenseSplitQuery.data,
    lastExpenseSplitQuery.isFetched,
    lastExpenseSplitQuery.isError,
    groupId,
  ]);

  const formatDateForInput = (date: Date): string => {
    return date.toISOString().split("T")[0];
  };

  const formatDateForDisplay = (dateStr: string): string => {
    if (!dateStr) return "Select date";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString(undefined, { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
      if (event.type === "set" && selectedDate) {
        setSelectedDate(selectedDate);
        setDate(formatDateForInput(selectedDate));
        if (dateError) setDateError("");
      }
    } else {
      if (selectedDate) {
        setSelectedDate(selectedDate);
      }
      if (event.type === "dismissed") {
        setShowDatePicker(false);
      }
    }
  };

  const parsedTotalAmount = useMemo(() => {
    const value = parseFloat(amount);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [amount]);

  // Inclusion is owned by shared selection chips (splitAmong) in every mode.
  // Older subset edits load only original participants into splitAmong; adding
  // someone is a chip toggle, not a blank amount field among the full group.
  const excludedAmountIds: string[] = [];
  const effectiveSplitIds = splitAmong;

  const handleToggleSplitMember = (participantId: string) => {
    const uniquePrev = [...new Set(splitAmong)];
    setSplitAmong(uniquePrev.includes(participantId)
      ? uniquePrev.filter((id) => id !== participantId)
      : [...uniquePrev, participantId]);
    if (splitAmongError) setSplitAmongError("");
  };

  const handleToggleAllMembers = () => {
    setSplitAmong(areAllParticipantsSelected ? [] : [...new Set(allParticipantIds)]);
    if (splitAmongError) setSplitAmongError("");
  };

  const handleSplitModeChange = (mode: SplitMode) => {
    setSplitMode(mode);
    const selectedIds = [...new Set(splitAmong)];
    if (mode === "unequal" && parsedTotalAmount && selectedIds.length > 0) {
      setSplitAmounts((current) => {
        const hasAny = selectedIds.some((id) => (current[id] || "").length > 0);
        if (hasAny) return current;
        if (splitMode === "shares") {
          return amountsFromShares(parsedTotalAmount, selectedIds, splitShares);
        }
        return equalSplitAmountMap(parsedTotalAmount, selectedIds);
      });
    }
    if (mode === "shares" && selectedIds.length > 0) {
      setSplitShares((current) => {
        const missing = selectedIds.some((id) => current[id] == null);
        return missing ? { ...defaultShareMap(selectedIds), ...current } : current;
      });
    }
    if (splitAmongError) setSplitAmongError("");
  };

  const handleSplitAmountChange = (participantId: string, text: string) => {
    setSplitAmounts((current) => ({ ...current, [participantId]: text }));
    if (splitAmongError) setSplitAmongError("");
  };

  const handleShareChange = (participantId: string, nextShares: number) => {
    setSplitShares((current) => ({ ...current, [participantId]: nextShares }));
    if (splitAmongError) setSplitAmongError("");
  };

  const handleSplitRemaining = () => {
    const selectedIds = [...new Set(splitAmong)];
    if (!parsedTotalAmount || selectedIds.length === 0) return;
    setSplitAmounts((current) =>
      distributeRemaining(current, selectedIds, parsedTotalAmount),
    );
    if (splitAmongError) setSplitAmongError("");
  };

  const customSplitsForSave = () => {
    if (!isGroupExpense || !parsedTotalAmount) return undefined;
    if (splitMode === "unequal") {
      return splitsFromAmountMap(splitAmounts, effectiveSplitIds) ?? undefined;
    }
    if (splitMode === "shares" && sharesAreUnequal(effectiveSplitIds, splitShares)) {
      return calculateShareSplits(parsedTotalAmount, effectiveSplitIds, splitShares);
    }
    return undefined;
  };

  // Backend split rows require strictly positive amounts, including after rounding.
  const equalSplitsReady = splitMode !== "equal" || (
    !!parsedTotalAmount && effectiveSplitIds.length > 0 &&
    calculateEqualSplits(parsedTotalAmount, effectiveSplitIds)
      .every((split) => split.amount > 0)
  );
  const sharesReady = splitMode !== "shares" || (
    !!parsedTotalAmount && effectiveSplitIds.length > 0 &&
    calculateShareSplits(parsedTotalAmount, effectiveSplitIds, splitShares)
      .every((split) => split.amount > 0)
  );

  const validateForm = (): boolean => {
    let isValid = true;
    setDescriptionError("");
    setAmountError("");
    setDateError("");
    setPaidByError("");
    setSplitAmongError("");

    if (!description.trim()) {
      setDescriptionError("Please enter a description");
      isValid = false;
    }

    if (!amount.trim()) {
      setAmountError("Please enter an amount");
      isValid = false;
    } else {
      const amountRegex = /^\d+(\.\d{1,2})?$/;
      if (!amountRegex.test(amount.trim())) {
        setAmountError("Please enter a valid amount (e.g., 10.50)");
        isValid = false;
      } else {
        const amountValue = parseFloat(amount);
        if (isNaN(amountValue) || !isFinite(amountValue) || amountValue <= 0) {
          setAmountError("Please enter a valid amount greater than 0");
          isValid = false;
        }
      }
    }

    if (!date.trim()) {
      setDateError("Please enter a date");
      isValid = false;
    }

    if (isGroupExpense) {
      if (!paidBy) {
        setPaidByError("Please select who paid for this expense");
        isValid = false;
      }
      if (effectiveSplitIds.length === 0) {
        setSplitAmongError("Please select at least one person to split the expense among");
        isValid = false;
      } else if (splitMode === "unequal") {
        const customSplits = splitsFromAmountMap(splitAmounts, effectiveSplitIds);
        if (!customSplits) {
          setSplitAmongError("Enter an amount greater than 0 for each person");
          isValid = false;
        } else {
          const leftover = remainingSplitAmount(
            parseFloat(amount),
            sumSelectedAmounts(splitAmounts, effectiveSplitIds),
          );
          if (Math.abs(leftover) > 0.01) {
            setSplitAmongError("Split amounts must add up to the expense total");
            isValid = false;
          }
        }
      } else if (splitMode === "equal" && !equalSplitsReady) {
        setSplitAmongError("Each person's split must round to an amount greater than 0. Increase the amount or select fewer people.");
        isValid = false;
      } else if (splitMode === "shares" && !sharesReady) {
        setSplitAmongError("Each person's share must round to an amount greater than 0");
        isValid = false;
      }
    }

    return isValid;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    const amountValue = parseFloat(amount);
    setLoading(true);
    try {
      await onSave({
        description: description.trim(),
        amount: amountValue,
        date: date.trim(),
        type,
        category: category.trim() || undefined,
        currency: currency || effectiveDefaultCurrency,
        paid_by_participant_id: isGroupExpense ? paidBy : undefined,
        split_among_participant_ids: isGroupExpense ? effectiveSplitIds : undefined,
        splits: customSplitsForSave(),
      });
    } catch (error) {
      Alert.alert("Error", getUserFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (!onDelete || !transaction || loading) return;
    const deleteTransaction = async () => {
      setLoading(true);
      try {
        await onDelete();
      } catch (error) {
        Alert.alert("Error", getUserFriendlyErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    void deleteTransaction();
  };

  const unequalSplitsReady = splitMode !== "unequal" || (
    !!parsedTotalAmount &&
    !!splitsFromAmountMap(splitAmounts, effectiveSplitIds) &&
    Math.abs(remainingSplitAmount(
      parsedTotalAmount,
      sumSelectedAmounts(splitAmounts, effectiveSplitIds),
    )) <= 0.01
  );

  const isSaveDisabled = loading
    || (isGroupExpense && effectiveSplitIds.length === 0)
    || (isGroupExpense && !unequalSplitsReady)
    || (isGroupExpense && !equalSplitsReady)
    || (isGroupExpense && !sharesReady);

  const filteredCurrencies = useMemo(
    () => filterCurrencies(currencySearch),
    [currencySearch]
  );

  useEffect(() => {
    if (!showCurrencyPicker) {
      setCurrencySearch("");
    }
  }, [showCurrencyPicker]);

  const handleHardwareBack = useCallback(() => {
    if (showCurrencyPicker) {
      setShowCurrencyPicker(false);
      return true;
    }
    if (showPaidByPicker) {
      setShowPaidByPicker(false);
      return true;
    }
    if (showCategoryPicker) {
      setShowCategoryPicker(false);
      return true;
    }
    if (
      showDatePicker &&
      (Platform.OS === "android" || Platform.OS === "web")
    ) {
      setShowDatePicker(false);
      return true;
    }
    onDismiss();
    return true;
  }, [onDismiss, showCurrencyPicker, showPaidByPicker, showCategoryPicker, showDatePicker]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", handleHardwareBack);
    return () => subscription.remove();
  }, [handleHardwareBack]);

  const categoryPickerItems = useMemo(
    () => [
      {
        key: "none",
        label: "No category",
        value: "",
        icon: "help-circle-outline",
        type: "none" as const,
      },
      ...CATEGORY_OPTIONS.map((option) => ({
        key: option.value,
        label: option.label,
        value: option.value,
        icon: option.icon,
        type: "preset" as const,
      })),
      {
        key: "custom",
        label: "Custom...",
        value: "",
        icon: "pencil-outline",
        type: "custom" as const,
      },
    ],
    []
  );

  const webHeroAmountInputStyle =
    Platform.OS === "web"
      ? ({
          ...getWebHeroAmountInputWidth(amount.length, heroAmountWidth),
          // RN Web focus ring; not in core TextStyle typings.
          outlineStyle: "solid",
          outlineWidth: 0,
        } as const)
      : null;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={["top", "left", "right"]}
    >
      {/* Header */}
      <Appbar.Header style={[styles.header, { backgroundColor: theme.colors.background }]}>
        <IconButton
          icon="arrow-left"
          iconColor={theme.colors.onSurface}
          onPress={onDismiss}
          accessibilityLabel="Navigate back"
          testID="transaction-form-back-button"
        />
        <Appbar.Content
          title={transaction ? "Edit Expense" : "Add Expense"}
          titleStyle={{ fontWeight: "600" }}
        />
        {transaction && onDelete && (
          <Appbar.Action
            icon="delete-outline"
            onPress={handleDelete}
            iconColor={theme.colors.error}
            accessibilityLabel="Delete expense"
            testID="delete-expense-button"
          />
        )}
      </Appbar.Header>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HERO AMOUNT SECTION */}
          <View
            style={styles.heroAmountContainer}
            onLayout={(event) => {
              const nextWidth = event.nativeEvent.layout.width;
              setHeroAmountWidth((prev) => (prev === nextWidth ? prev : nextWidth));
            }}
          >
            <View style={styles.heroAmountInputRow}>
              <Text 
                variant="displayMedium" 
                style={[styles.heroAmountText, { color: theme.colors.onSurface }]}
              >
                {getCurrencySymbol(currency)}
              </Text>
              <RNTextInput
                ref={amountInputRef}
                value={amount}
                onChangeText={(text) => {
                  // Only allow numbers and one decimal point
                  const cleaned = text.replace(/[^0-9.]/g, '');
                  const parts = cleaned.split('.');
                  if (parts.length > 2) return;
                  if (parts[1]?.length > 2) return;
                  setAmount(cleaned);
                  if (amountError) setAmountError("");
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[
                  styles.heroAmountInput, 
                  { 
                    color: theme.colors.onSurface,
                    minWidth: amount ? undefined : 40,
                  },
                  // Web <input> defaults to ~20ch wide; at fontSize 45 that overflows the viewport.
                  webHeroAmountInputStyle,
                ]}
                testID="amount-input"
                accessibilityHint={amountError || undefined}
                accessibilityLabel={`Expense amount, ${currency}`}
                autoFocus={!transaction}
                selectTextOnFocus
              />
            </View>
            {amountError && (
              <Text variant="bodySmall" accessibilityLiveRegion="polite" style={{ color: theme.colors.error, marginTop: 4 }}>
                {amountError}
              </Text>
            )}

            {/* Currency Chip */}
            <Chip 
              mode="outlined" 
              onPress={() => setShowCurrencyPicker(true)}
              style={styles.currencyChip}
              disabled={loading}
              testID="currency-chip"
            >
              {currency}
            </Chip>
            {groupSettings?.enabled && settlementCurrency && settlementCurrency !== currency ? (
              <ConvertedAmountHint
                amount={convertAmount(Number.parseFloat(amount) || 0, currency, settlementCurrency, rateBook) ?? 0}
                currency={settlementCurrency}
                quote={resolveRate(currency, settlementCurrency, rateBook)}
                onPressRate={() => setShowRateEditor(true)}
              />
            ) : null}
          </View>

          {/* DETAILS CARD */}
          <Card style={styles.card} mode="outlined">
            <Card.Content>
              <TextInput
                testID="description-input"
                accessibilityHint={descriptionError || undefined}
                label="Description"
                value={description}
                onChangeText={(text) => {
                  setDescription(text);
                  if (descriptionError) setDescriptionError("");
                }}
                mode="flat"
                disabled={loading}
                error={!!descriptionError}
                style={styles.flatInput}
                left={<TextInput.Icon icon="pencil-outline" />}
                placeholder="What was this for?"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              {descriptionError && (
                <Text variant="bodySmall" accessibilityLiveRegion="polite" style={{ color: theme.colors.error, marginLeft: 12 }}>
                  {descriptionError}
                </Text>
              )}

              <Divider style={styles.divider} />

              <Pressable onPress={() => setShowDatePicker(true)} disabled={loading}>
                <View style={styles.dateRow}>
                  <IconButton icon="calendar-outline" size={24} accessible={false} importantForAccessibility="no" />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      Date
                    </Text>
                    <Text variant="bodyLarge">
                      {formatDateForDisplay(date)}
                    </Text>
                  </View>
                  <IconButton icon="chevron-right" size={24} accessible={false} importantForAccessibility="no" />
                </View>
              </Pressable>
              {dateError && (
                <Text variant="bodySmall" accessibilityLiveRegion="polite" style={{ color: theme.colors.error, marginLeft: 12 }}>
                  {dateError}
                </Text>
              )}

              <Divider style={styles.divider} />

              <Pressable
                onPress={() => setShowCategoryPicker(true)}
                disabled={loading}
              >
                <View style={styles.selectRow}>
                  <IconButton icon="tag-outline" size={24} accessible={false} importantForAccessibility="no" />
                  <View style={styles.selectRowContent}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      Category
                    </Text>
                    <Text
                      variant="bodyLarge"
                      numberOfLines={1}
                      style={{
                        color: category.trim() || useCustomCategoryInput
                          ? theme.colors.onSurface
                          : theme.colors.onSurfaceVariant,
                      }}
                    >
                      {useCustomCategoryInput
                        ? category.trim() || "Custom"
                        : category.trim()
                          ? getCategoryDisplayLabel(category)
                          : "No category"}
                    </Text>
                  </View>
                  <IconButton icon="chevron-down" size={24} accessible={false} importantForAccessibility="no" />
                </View>
              </Pressable>

              {useCustomCategoryInput && (
                <TextInput
                  label="Custom category"
                  value={category}
                  onChangeText={setCategory}
                  mode="flat"
                  disabled={loading}
                  style={[styles.flatInput, styles.customCategoryInput]}
                  left={<TextInput.Icon icon="pencil-outline" />}
                  right={
                    category.trim() ? (
                      <TextInput.Icon icon="close" accessibilityLabel="Clear custom category" onPress={() => setCategory("")} />
                    ) : undefined
                  }
                  placeholder="Write your own category"
                />
              )}
            </Card.Content>
          </Card>

          {/* SPLITTING CARD - Only for group expenses */}
          {isGroupExpense && (
            <Card style={styles.card} mode="outlined">
              <Card.Content>
                {/* Paid By Section */}
                <View style={styles.sectionHeader}>
                  <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                    Paid by
                  </Text>
                </View>
                {paidByError && (
                  <Text variant="bodySmall" accessibilityLiveRegion="polite" style={{ color: theme.colors.error, marginBottom: 8 }}>
                    {paidByError}
                  </Text>
                )}
                
                {useInlineChipsForPaidBy ? (
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScrollView}
                  >
                    {availableParticipants.map((p) => {
                      const isSelected = paidBy === p.id;
                      const displayName = p.full_name || p.email?.split("@")[0] || p.email || "Unknown";
                      const isFormer = p.type === "former";
                      return (
                        <Chip
                          key={p.id}
                          selected={isSelected}
                          onPress={() => {
                            setPaidBy(p.id);
                            if (paidByError) setPaidByError("");
                          }}
                          style={[
                            styles.chip,
                            isFormer && styles.formerChip,
                            !isSelected && { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          theme={{
                            colors: {
                              secondaryContainer: theme.colors.primaryContainer,
                              onSecondaryContainer: theme.colors.onPrimaryContainer,
                            },
                          }}
                          disabled={loading}
                          showSelectedCheck={true}
                          testID={`paid-by-chip-${p.email || p.id}`}
                        >
                          {displayName}
                          {isFormer && " (Former)"}
                        </Chip>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <Button
                    mode="outlined"
                    onPress={() => setShowPaidByPicker(true)}
                    style={styles.paidByButton}
                    icon="account"
                    contentStyle={{ justifyContent: "flex-start" }}
                    disabled={loading}
                  >
                    {paidByParticipant 
                      ? `${paidByParticipant.full_name || paidByParticipant.email?.split("@")[0] || paidByParticipant.email || "Unknown"}${paidByParticipant.type === 'former' ? " (Former)" : ""}`
                      : "Select who paid"}
                  </Button>
                )}

                <Divider style={styles.divider} />

                <SplitAmongEditor
                  participants={availableParticipants}
                  selectedIds={splitAmong}
                  amounts={splitAmounts}
                  excludedAmountIds={excludedAmountIds}
                  shares={splitShares}
                  mode={splitMode}
                  totalAmount={parsedTotalAmount}
                  currency={currency}
                  error={splitAmongError}
                  disabled={loading}
                  areAllSelected={areAllParticipantsSelected}
                  onToggleMember={handleToggleSplitMember}
                  onToggleAll={handleToggleAllMembers}
                  onModeChange={handleSplitModeChange}
                  onAmountChange={handleSplitAmountChange}
                  onShareChange={handleShareChange}
                  onSplitRemaining={handleSplitRemaining}
                />
              </Card.Content>
            </Card>
          )}

        </ScrollView>

        {/* STICKY BOTTOM ACTION BAR */}
        <Surface 
          style={[
            styles.bottomBar, 
            { paddingBottom: insets.bottom + 16 }
          ]} 
          elevation={2}
        >
          <Button
            testID="save-expense-button"
            mode="contained"
            onPress={handleSave}
            disabled={isSaveDisabled}
            loading={loading}
            style={styles.saveButton}
            contentStyle={styles.saveButtonContent}
          >
            {transaction ? "Update" : "Save expense"}
          </Button>
        </Surface>
      </KeyboardAvoidingView>

      {/* Date Picker */}
      {showDatePicker && (
        <>
          {Platform.OS === "ios" && (
            <Modal visible={showDatePicker} transparent animationType="slide">
              <TouchableOpacity 
                style={styles.modalOverlay} 
                activeOpacity={1} 
                onPress={() => setShowDatePicker(false)}
              >
                <View 
                  style={[styles.datePickerModal, { backgroundColor: theme.colors.surface }]}
                  onStartShouldSetResponder={() => true}
                >
                  <View style={styles.datePickerHeader}>
                    <Button onPress={() => setShowDatePicker(false)}>Cancel</Button>
                    <Text variant="titleMedium">Select Date</Text>
                    <Button
                      onPress={() => {
                        setDate(formatDateForInput(selectedDate));
                        setShowDatePicker(false);
                        if (dateError) setDateError("");
                      }}
                    >
                      Done
                    </Button>
                  </View>
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display="spinner"
                    onChange={handleDateChange}
                    maximumDate={new Date()}
                    style={{ height: 200 }}
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          )}
          {Platform.OS === "android" && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="default"
              onChange={handleDateChange}
              maximumDate={new Date()}
            />
          )}
          {Platform.OS === "web" && (
            <Modal visible={showDatePicker} transparent animationType="slide">
              <View style={styles.modalOverlay}>
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => setShowDatePicker(false)}
                />
                <View
                  style={[
                    styles.datePickerModal,
                    {
                      backgroundColor: theme.colors.surface,
                      zIndex: 1,
                    },
                  ]}
                >
                  <View style={styles.datePickerHeader}>
                    <Button onPress={() => setShowDatePicker(false)}>Cancel</Button>
                    <Text variant="titleMedium">Select Date</Text>
                    <Button
                      onPress={() => {
                        setDate(formatDateForInput(selectedDate));
                        setShowDatePicker(false);
                        if (dateError) setDateError("");
                      }}
                    >
                      Done
                    </Button>
                  </View>
                  <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                    <TransactionWebDateField
                      value={formatDateForInput(selectedDate)}
                      max={formatDateForInput(new Date())}
                      onChange={(iso) => {
                        setSelectedDate(new Date(`${iso}T12:00:00`));
                      }}
                      textColor={theme.colors.onSurface}
                      outlineColor={theme.colors.outline}
                      backgroundColor={theme.colors.surface}
                    />
                  </View>
                </View>
              </View>
            </Modal>
          )}
        </>
      )}

      {/* Paid By Picker Modal (for > 5 participants) */}
      <Modal
        visible={showPaidByPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPaidByPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPaidByPicker(false)}
        >
          <View
            style={[styles.pickerModal, { backgroundColor: theme.colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.pickerHeader}>
              <Text variant="titleLarge">Who paid?</Text>
              <IconButton icon="close" accessibilityLabel="Close payer picker" onPress={() => setShowPaidByPicker(false)} />
            </View>
            <FlatList
              data={availableParticipants}
              keyExtractor={(item) => item.id}
              style={styles.pickerList}
              renderItem={({ item }) => {
                const isSelected = paidBy === item.id;
                const displayName = item.full_name || item.email?.split("@")[0] || item.email || "Unknown";
                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerItem,
                      isSelected && { backgroundColor: theme.colors.primaryContainer },
                    ]}
                    onPress={() => {
                      setPaidBy(item.id);
                      setShowPaidByPicker(false);
                      if (paidByError) setPaidByError("");
                    }}
                  >
                    <Text variant="bodyLarge">
                      {displayName}
                      {item.type === 'former' && " (Former)"}
                    </Text>
                    {isSelected && (
                      <IconButton icon="check" size={20} iconColor={theme.colors.primary} accessible={false} importantForAccessibility="no" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Category Picker Modal */}
      <Modal
        visible={showCategoryPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCategoryPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCategoryPicker(false)}
        >
          <View
            style={[styles.pickerModal, { backgroundColor: theme.colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.pickerHeader}>
              <Text variant="titleLarge">Select Category</Text>
              <IconButton icon="close" accessibilityLabel="Close category picker" onPress={() => setShowCategoryPicker(false)} />
            </View>
            <FlatList
              data={categoryPickerItems}
              keyExtractor={(item) => item.key}
              style={styles.pickerList}
              contentContainerStyle={styles.categoryPickerListContent}
              renderItem={({ item }) => {
                const isSelected =
                  item.type === "custom"
                    ? useCustomCategoryInput
                    : item.type === "none"
                      ? !category.trim() && !useCustomCategoryInput
                      : !useCustomCategoryInput &&
                        category.trim().toLowerCase() === item.value.toLowerCase();

                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerItem,
                      isSelected && { backgroundColor: theme.colors.primaryContainer },
                    ]}
                    onPress={() => {
                      if (item.type === "custom") {
                        setUseCustomCategoryInput(true);
                      } else {
                        setCategory(item.value);
                        setUseCustomCategoryInput(false);
                      }
                      setShowCategoryPicker(false);
                    }}
                  >
                    <View style={styles.pickerItemLabel}>
                      <IconButton
                        icon={item.icon}
                        accessible={false}
                        importantForAccessibility="no"
                        size={22}
                        iconColor={theme.colors.onSurfaceVariant}
                        style={styles.pickerItemIcon}
                      />
                      <Text variant="bodyLarge">{item.label}</Text>
                    </View>
                    {isSelected && (
                      <IconButton icon="check" size={20} iconColor={theme.colors.primary} accessible={false} importantForAccessibility="no" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Currency Picker Modal */}
      <Modal
        visible={showCurrencyPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCurrencyPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCurrencyPicker(false)}
        >
          <View
            style={[styles.pickerModal, { backgroundColor: theme.colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.pickerHeader}>
              <Text variant="titleLarge">Select Currency</Text>
              <IconButton icon="close" accessibilityLabel="Close currency picker" onPress={() => setShowCurrencyPicker(false)} />
            </View>
            <Searchbar
              placeholder="Search currencies"
              value={currencySearch}
              onChangeText={setCurrencySearch}
              style={styles.currencySearch}
              inputStyle={styles.currencySearchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <FlatList
              data={filteredCurrencies}
              keyExtractor={(item) => item.code}
              style={styles.pickerList}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text variant="bodyMedium" style={styles.currencyEmpty}>
                  No currencies match that search.
                </Text>
              }
              renderItem={({ item }) => {
                const isSelected = currency === item.code;
                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerItem,
                      isSelected && { backgroundColor: theme.colors.primaryContainer },
                    ]}
                    onPress={() => {
                      setCurrency(item.code);
                      setShowCurrencyPicker(false);
                    }}
                  >
                    <View style={styles.currencyPickerCopy}>
                      <Text variant="bodyLarge">
                        {item.code} ({item.symbol})
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {item.name}
                      </Text>
                    </View>
                    {isSelected && (
                      <IconButton icon="check" size={20} iconColor={theme.colors.primary} accessible={false} importantForAccessibility="no" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {groupId && settlementCurrency ? (
        <ExchangeRateEditor
          visible={showRateEditor}
          from={currency}
          to={settlementCurrency}
          amount={Number.parseFloat(amount) || 1}
          rateBook={rateBook}
          onDismiss={() => setShowRateEditor(false)}
          onSave={(rate) => {
            void setGroupRate(groupId, currency, settlementCurrency, rate, "expense");
            setShowRateEditor(false);
          }}
          onResetToMarket={() => {
            void clearGroupRate(groupId, currency, settlementCurrency);
            setShowRateEditor(false);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 0,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  
  // Hero Amount
  heroAmountContainer: {
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    maxWidth: "100%",
    paddingVertical: 32,
    marginBottom: 8,
  },
  heroAmountInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: "100%",
    flexShrink: 1,
  },
  heroAmountText: {
    fontWeight: "300",
    letterSpacing: -2,
    flexShrink: 0,
  },
  heroAmountInput: {
    fontSize: 45,
    fontWeight: "300",
    letterSpacing: -2,
    textAlign: "left",
    padding: 0,
    margin: 0,
    flexShrink: 1,
    minWidth: 40,
    maxWidth: "100%",
  },
  currencyChip: {
    marginTop: 12,
  },

  // Cards
  card: {
    marginBottom: 16,
    borderRadius: 16,
  },
  flatInput: {
    backgroundColor: "transparent",
  },
  divider: {
    marginVertical: 8,
  },
  
  // Date Row
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  selectRowContent: {
    flex: 1,
    minWidth: 0,
  },
  customCategoryInput: {
    marginTop: 8,
  },

  // Section Headers
  sectionHeader: {
    marginBottom: 12,
  },

  // Chips
  chipScrollView: {
    marginBottom: 8,
  },
  chip: {
    marginRight: 8,
  },
  formerChip: {
    opacity: 0.7,
  },

  paidByButton: {
    marginBottom: 8,
  },

  // Type Row
  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  typeChips: {
    flexDirection: "row",
    gap: 8,
  },
  typeChip: {
    // chipStyle
  },

  // Bottom Bar
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  saveButton: {
    borderRadius: 24,
  },
  saveButtonContent: {
    paddingVertical: 8,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    width: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  datePickerModal: {
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
  },
  datePickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  pickerModal: {
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
  },
  currencySearch: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  currencySearchInput: {
    fontSize: 16,
  },
  currencyPickerCopy: {
    flex: 1,
    minWidth: 0,
  },
  currencyEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    textAlign: "center",
    opacity: 0.7,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  pickerList: {
    padding: 8,
  },
  categoryPickerListContent: {
    paddingBottom: 48,
  },
  pickerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
  },
  pickerItemLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  pickerItemIcon: {
    margin: 0,
    marginRight: 8,
  },
});
