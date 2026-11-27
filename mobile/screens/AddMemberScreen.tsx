import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Divider,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useKeyboardOverlap } from "../hooks/useKeyboardOverlap";
import { CountryCodePicker } from "../components/CountryCodePicker";
import { useAuth } from "../contexts/AuthContext";
import { requestGuestSignIn } from "../utils/guestGate";
import { guestSignInCopy, isGuestUser } from "../utils/guestMode";
import { useCreateGroupShareLink } from "../hooks/useGroupInvitations";
import { useExistingPeople } from "../hooks/useParticipants";
import { useProfile } from "../hooks/useProfile";
import { getInviteLinkUrl } from "../utils/inviteLinks";
import {
  INVITE_LINK_MAX_USES,
  INVITE_LINK_VALID_DAYS,
} from "../utils/inviteShare";
import { shareInviteLink } from "../utils/inviteShareAction";
import { showErrorAlert } from "../utils/errorHandling";
import {
  type CountryCode,
  getCountryByCode,
} from "../utils/countryCodes";
import {
  type ExistingPerson,
  existingPersonLabel,
  filterAndSortExistingPeople,
} from "../utils/peoplePicker";
import { getOptionalEmailFormatError } from "../utils/emailValidation";
import {
  DEFAULT_PHONE_COUNTRY_CODE,
  getOptionalPhoneFormatError,
  normalizePhoneToE164,
} from "../utils/phoneValidation";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import {
  addMemberModeDismissesKeyboard,
  getAddMemberSheetFrame,
  keyboardHeightForAddMemberMode,
  revealAddMemberField,
} from "../utils/addMemberSheetLayout";

interface AddMemberScreenProps {
  visible: boolean;
  groupId: string;
  /** Optional display name already loaded by the caller; used in share text only. */
  groupName?: string;
  onAddMember: (person: {
    fullName?: string;
    email?: string | null;
    phone?: string | null;
    countryCode?: string | null;
    sourceParticipantId?: string;
  }) => Promise<unknown>;
  onDismiss: () => void;
}

type SheetMode = "chooser" | "create" | "existing";
type AddPersonField = "name" | "email" | "phone";

const ADD_PERSON_FIELDS: AddPersonField[] = ["name", "email", "phone"];

type FollowerGap = {
  before: AddPersonField;
  height: number;
};

export const AddMemberScreen: React.FC<AddMemberScreenProps> = ({
  visible,
  groupId,
  groupName,
  onAddMember,
  onDismiss,
}) => {
  const [mode, setMode] = useState<SheetMode>("chooser");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    () => getCountryByCode(DEFAULT_PHONE_COUNTRY_CODE) ||
      {
        code: DEFAULT_PHONE_COUNTRY_CODE,
        dialCode: "+91",
        name: "India",
        flag: "🇮🇳",
      },
  );
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [slideAnim] = useState(new Animated.Value(0));
  const [focusedField, setFocusedField] = useState<AddPersonField | null>(null);
  const [fieldLayouts, setFieldLayouts] = useState<
    Partial<Record<AddPersonField, { y: number; height: number }>>
  >({});
  const [introLayout, setIntroLayout] = useState<{ y: number; height: number } | null>(
    null,
  );
  const [followerGap, setFollowerGap] = useState<FollowerGap | null>(null);
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const lockedScrollOffset = useRef(0);
  const layoutEpoch = useRef(0);
  const revealKey = useRef("");
  const waitForLayoutEpoch = useRef<number | null>(null);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOverlap(visible);
  const { signOut, user } = useAuth();
  const { data: profile } = useProfile();
  const createShareLink = useCreateGroupShareLink();
  const useNativeDriver = Platform.OS !== "web";
  const { data: existingPeople, isLoading: existingPeopleLoading } =
    useExistingPeople(
      groupId,
      visible && mode === "existing",
    );

  const filteredPeople = useMemo(
    () => filterAndSortExistingPeople(existingPeople, search),
    [existingPeople, search],
  );

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible, slideAnim, useNativeDriver]);

  useEffect(() => {
    if (!visible) return;
    const profileCountry = profile?.country_code
      ? getCountryByCode(profile.country_code)
      : null;
    const defaultCountry = getCountryByCode(DEFAULT_PHONE_COUNTRY_CODE);
    setSelectedCountry(
      profileCountry ||
        defaultCountry ||
        {
          code: DEFAULT_PHONE_COUNTRY_CODE,
          dialCode: "+91",
          name: "India",
          flag: "🇮🇳",
        },
    );
  }, [profile?.country_code, visible]);

  // The chooser has no text field. Dismiss a keyboard left open by the form
  // or the search box, including when this sheet opens already on the chooser.
  useEffect(() => {
    if (!visible || !addMemberModeDismissesKeyboard(mode)) return;
    setFocusedField(null);
    Keyboard.dismiss();
  }, [visible, mode]);

  const showChooser = () => {
    setFocusedField(null);
    if (addMemberModeDismissesKeyboard("chooser")) Keyboard.dismiss();
    setMode("chooser");
  };

  const handleDismiss = () => {
    showChooser();
    setFullName("");
    setEmail("");
    setEmailError(null);
    setPhoneNumber("");
    setPhoneError(null);
    setShowCountryPicker(false);
    setSearch("");
    setInviteLink(null);
    setFocusedField(null);
    onDismiss();
  };

  const generateInviteLink = async (): Promise<string> => {
    if (inviteLink) return inviteLink;
    const token = await createShareLink.mutateAsync({
      groupId,
      maxUses: INVITE_LINK_MAX_USES,
      validDays: INVITE_LINK_VALID_DAYS,
    });
    const url = getInviteLinkUrl(token);
    setInviteLink(url);
    captureIdentifiedAnalyticsEvent(
      user?.id,
      ANALYTICS_EVENTS.INVITE_LINK_CREATED,
      {
        group_id: groupId,
        invite_type: "share_link",
        max_uses: INVITE_LINK_MAX_USES,
        valid_days: INVITE_LINK_VALID_DAYS,
      },
    );
    return url;
  };

  const handleShareLink = async () => {
    if (isGuestUser(user)) {
      requestGuestSignIn(guestSignInCopy("share_link", groupName));
      return;
    }
    setLoading(true);
    try {
      const url = await generateInviteLink();
      const result = await shareInviteLink(url, groupName);
      if (result === "shared") {
        captureIdentifiedAnalyticsEvent(
          user?.id,
          ANALYTICS_EVENTS.INVITE_LINK_SHARED,
          {
            group_id: groupId,
            invite_type: "share_link",
            share_channel: Platform.OS === "web" ? "web" : Platform.OS,
          },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!/abort|cancel/i.test(message)) {
        showErrorAlert(err, signOut, "Error sharing invite link");
      }
    } finally {
      setLoading(false);
    }
  };

  const sharePhoneInviteLink = async (url: string) => {
    await shareInviteLink(url, groupName, {
      copiedMessage: "Share it by SMS, WhatsApp, or any app you prefer.",
    });
  };

  const handleAdd = async () => {
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phoneNumber.trim();
    if (!trimmedName) {
      Alert.alert("Error", "Please enter a name");
      return;
    }
    const formatError = getOptionalEmailFormatError(trimmedEmail);
    if (formatError) {
      setEmailError(formatError);
      return;
    }
    setEmailError(null);

    const phoneFormatError = getOptionalPhoneFormatError(
      trimmedPhone,
      selectedCountry.code,
    );
    if (phoneFormatError) {
      setPhoneError(phoneFormatError);
      return;
    }
    const normalizedPhone = trimmedPhone
      ? normalizePhoneToE164(trimmedPhone, selectedCountry.code)
      : null;
    setPhoneError(null);

    if (isGuestUser(user) && (trimmedEmail || normalizedPhone)) {
      requestGuestSignIn(guestSignInCopy("invite", trimmedName));
      return;
    }

    setLoading(true);
    try {
      const result = await onAddMember({
        fullName: trimmedName,
        email: trimmedEmail || null,
        phone: normalizedPhone,
        countryCode: selectedCountry.code,
      });
      const inviteToken = typeof result === "object" && result !== null
        ? (result as { token?: string | null }).token
        : null;

      if (normalizedPhone && inviteToken) {
        await sharePhoneInviteLink(getInviteLinkUrl(inviteToken));
        Alert.alert("Invitation ready", "Share it by SMS or WhatsApp.", [
          { text: "OK", onPress: handleDismiss },
        ]);
        return;
      }

      Alert.alert("Added", normalizedPhone
        ? "This person was added to the group."
        : "This person can now be included in expenses.", [
        { text: "OK", onPress: handleDismiss },
      ]);
    } catch (error) {
      showErrorAlert(error, signOut, "Error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddExisting = async (person: ExistingPerson) => {
    setLoading(true);
    try {
      await onAddMember({ sourceParticipantId: person.id });
      const addedLabel = existingPersonLabel(person) || person.email ||
        "This person";
      Alert.alert("Added", `${addedLabel} was added to this group.`, [
        { text: "OK", onPress: handleDismiss },
      ]);
    } catch (error) {
      showErrorAlert(error, signOut, "Error adding person");
    } finally {
      setLoading(false);
    }
  };

  const isExistingPicker = mode === "existing";
  // The create form used to sit in a fixed-height sheet with KeyboardAvoidingView
  // only around that ScrollView. On a short phone the keyboard covered the
  // fields, and the existing-person list was not avoiding the keyboard at all.
  // Lift the whole sheet by the keyboard overlap instead.
  const sheetFrame = getAddMemberSheetFrame({
    windowHeight: keyboard.windowHeight,
    restingWindowHeight: keyboard.restingWindowHeight,
    topInset: insets.top,
    keyboardHeight: keyboardHeightForAddMemberMode(mode, keyboard.frame.height),
    keyboardScreenY: keyboard.frame.screenY,
    fullScreen: isExistingPicker,
  });
  const bottomSheetHeight = sheetFrame.height;

  const rememberIntroLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setIntroLayout((prev) => {
      if (prev && prev.y === y && prev.height === height) return prev;
      return { y, height };
    });
  };

  const rememberFieldLayout = (field: AddPersonField) =>
    (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      setFieldLayouts((prev) => {
        const current = prev[field];
        if (current && current.y === y && current.height === height) return prev;
        layoutEpoch.current += 1;
        return { ...prev, [field]: { y, height } };
      });
    };

  // While Email is focused, Name has to stay on screen and Phone must not
  // remain as a cut label between Email and the pinned Add person button.
  // The gap is frozen for a given focus + viewport so applying it (which
  // shifts later rows) does not feed back into the next measurement.
  useEffect(() => {
    if (!sheetFrame.keyboardOpen || focusedField == null || scrollViewportHeight <= 0) {
      revealKey.current = "";
      waitForLayoutEpoch.current = null;
      setFollowerGap((prev) => (prev == null ? prev : null));
      return;
    }
    const name = fieldLayouts.name;
    const email = fieldLayouts.email;
    const phone = fieldLayouts.phone;
    if (
      !name || !email || !phone ||
      name.height <= 0 || email.height <= 0 || phone.height <= 0
    ) {
      return;
    }
    const key = [
      focusedField,
      Math.round(scrollViewportHeight),
      Math.round(name.y),
      Math.round(name.height),
      Math.round(email.height),
      Math.round(phone.height),
      focusedField === "phone" && introLayout
        ? `${Math.round(introLayout.y)}:${Math.round(introLayout.height)}`
        : "",
    ].join(":");
    if (revealKey.current === key) {
      scrollRef.current?.scrollTo({ y: lockedScrollOffset.current, animated: false });
      return;
    }

    if (followerGap != null) {
      waitForLayoutEpoch.current = layoutEpoch.current;
      revealKey.current = "";
      setFollowerGap(null);
      return;
    }
    if (
      waitForLayoutEpoch.current != null &&
      layoutEpoch.current <= waitForLayoutEpoch.current
    ) {
      return;
    }
    waitForLayoutEpoch.current = null;

    const reveal = revealAddMemberField({
      fields: [name, email, phone],
      focusedIndex: ADD_PERSON_FIELDS.indexOf(focusedField),
      alsoVisible: focusedField === "email" ? [0] : [],
      hidePartialAbove: focusedField === "phone" ? introLayout : null,
      viewportHeight: scrollViewportHeight,
      currentOffset: scrollOffset.current,
    });
    revealKey.current = key;
    lockedScrollOffset.current = reveal.offset;
    scrollOffset.current = reveal.offset;
    scrollRef.current?.scrollTo({ y: reveal.offset, animated: false });
    if (reveal.gap > 0 && reveal.gapBeforeIndex != null) {
      const before = ADD_PERSON_FIELDS[reveal.gapBeforeIndex];
      if (before) {
        setFollowerGap({ before, height: reveal.gap });
        return;
      }
    }
    setFollowerGap(null);
  }, [
    sheetFrame.keyboardOpen,
    focusedField,
    fieldLayouts,
    scrollViewportHeight,
    followerGap,
    introLayout,
  ]);

  const followerSpacer = (before: AddPersonField) => (
    followerGap?.before === before && followerGap.height > 0
      ? <View style={{ height: followerGap.height }} />
      : null
  );

  const renderAddButton = () => (
    <Button
      mode="contained"
      onPress={handleAdd}
      disabled={loading}
      loading={loading}
      style={styles.addButton}
      testID="add-member-submit-button"
    >
      Add person
    </Button>
  );
  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [bottomSheetHeight, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleDismiss}
    >
      <View style={styles.modalOverlay}>
        {!isExistingPicker && (
          <Pressable style={styles.backdrop} onPress={handleDismiss} />
        )}
        <Animated.View
          style={[
            styles.sheet,
            isExistingPicker && styles.pickerSheet,
            {
              height: bottomSheetHeight,
              transform: [{ translateY }],
              paddingBottom: sheetFrame.keyboardOpen ? 0 : insets.bottom,
              marginBottom: sheetFrame.marginBottom,
              paddingTop: isExistingPicker ? insets.top : 0,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          {isExistingPicker
            ? (
              <View style={styles.pickerContent}>
                <Appbar.Header style={styles.header}>
                  <Appbar.BackAction onPress={showChooser} />
                  <Appbar.Content
                    title="Choose existing person"
                    titleStyle={styles.title}
                  />
                  <Appbar.Action icon="close" onPress={handleDismiss} />
                </Appbar.Header>
                <View style={styles.pickerBody}>
                  <TextInput
                    mode="outlined"
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search people"
                    left={<TextInput.Icon icon="magnify" />}
                    autoCapitalize="words"
                    disabled={loading}
                    accessibilityLabel="Search existing people"
                  />
                  <Text
                    variant="labelLarge"
                    style={[styles.sectionLabel, {
                      color: theme.colors.onSurfaceVariant,
                    }]}
                  >
                    People you’ve grouped with
                  </Text>
                </View>
                <ScrollView
                  style={styles.pickerList}
                  contentContainerStyle={styles.peopleList}
                  keyboardShouldPersistTaps="handled"
                >
                  {existingPeopleLoading
                    ? <ActivityIndicator style={styles.loadingIndicator} />
                    : filteredPeople.length > 0
                    ? (
                      filteredPeople.map((person) => {
                        const label = existingPersonLabel(person);
                        const initials = (label || "?").slice(0, 2)
                          .toUpperCase();
                        return (
                        <Pressable
                          key={person.id}
                          onPress={() => handleAddExisting(person)}
                          disabled={loading}
                          style={(
                            { pressed },
                          ) => [styles.personRow, pressed && styles.pressedRow]}
                          accessibilityRole="button"
                          accessibilityLabel={person.email
                            ? `Add ${label}, ${person.email}`
                            : `Add ${label}`}
                        >
                          <View
                            style={[styles.avatar, {
                              backgroundColor: theme.colors.primaryContainer,
                            }]}
                          >
                            <Text
                              style={{
                                color: theme.colors.onPrimaryContainer,
                                fontWeight: "700",
                              }}
                            >
                              {initials}
                            </Text>
                          </View>
                          <View style={styles.personText}>
                            <Text variant="bodyLarge">{label}</Text>
                            {person.email
                              ? (
                                <Text
                                  variant="bodySmall"
                                  style={{
                                    color: theme.colors.onSurfaceVariant,
                                  }}
                                >
                                  {person.email}
                                </Text>
                              )
                              : null}
                          </View>
                          <Appbar.Action
                            icon="chevron-right"
                            onPress={() => handleAddExisting(person)}
                          />
                        </Pressable>
                        );
                      })
                    )
                    : (
                      <View style={styles.emptyState}>
                        <Text variant="titleMedium">
                          No one you’ve grouped with yet
                        </Text>
                        <Text
                          style={{
                            color: theme.colors.onSurfaceVariant,
                            textAlign: "center",
                          }}
                        >
                          Anyone you’ve shared a group with will show up here.
                          Only their name and email are listed.
                        </Text>
                        <Button
                          mode="outlined"
                          onPress={() => setMode("create")}
                          icon="account-plus"
                        >
                          Create new person
                        </Button>
                      </View>
                    )}
                </ScrollView>
              </View>
            )
            : (
              <>
                <View style={styles.handleContainer}>
                  <View
                    style={[styles.handle, {
                      backgroundColor: theme.colors.outlineVariant,
                    }]}
                  />
                </View>
                <Appbar.Header style={styles.header}>
                  {mode === "create" && (
                    <Appbar.BackAction onPress={showChooser} />
                  )}
                  <Appbar.Content
                    title="Add people"
                    titleStyle={styles.title}
                  />
                  <Appbar.Action icon="close" onPress={handleDismiss} />
                </Appbar.Header>
                {mode === "chooser"
                  ? (
                    <View style={styles.chooserContent}>
                      <Text
                        style={[styles.subtitle, {
                          color: theme.colors.onSurfaceVariant,
                        }]}
                      >
                        Pick someone you’ve shared a group with, or create
                        someone new.
                      </Text>
                      <ChoiceCard
                        icon="account-group"
                        title="Choose existing person"
                        description="Name and email only"
                        primary
                        onPress={() => setMode("existing")}
                      />
                      <ChoiceCard
                        icon="account-plus"
                        title="Create new person"
                        description="Add someone new to this group"
                        onPress={() => setMode("create")}
                      />
                      <View style={styles.dividerRow}>
                        <Divider style={styles.dividerLine} />
                        <Text
                          style={{
                            marginHorizontal: 16,
                            color: theme.colors.outline,
                          }}
                        >
                          OR
                        </Text>
                        <Divider style={styles.dividerLine} />
                      </View>
                      <Button
                        mode="outlined"
                        onPress={handleShareLink}
                        disabled={loading}
                        loading={createShareLink.isPending}
                        icon="share-variant"
                      >
                        Invite to SharedMoney
                      </Button>
                      <Text
                        style={[styles.linkHint, {
                          color: theme.colors.onSurfaceVariant,
                        }]}
                      >
                        {`Anyone with this link can join. Works for up to ${INVITE_LINK_MAX_USES} people for ${INVITE_LINK_VALID_DAYS} days.`}
                      </Text>
                    </View>
                  )
                  : (
                    <View style={styles.formColumn}>
                      <ScrollView
                        ref={scrollRef}
                        style={styles.formScroll}
                        contentContainerStyle={[
                          styles.formContent,
                          sheetFrame.keyboardOpen && styles.formContentWithFooter,
                        ]}
                        keyboardShouldPersistTaps="handled"
                        onScroll={(event) => {
                          scrollOffset.current = event.nativeEvent.contentOffset.y;
                        }}
                        scrollEventThrottle={16}
                        onLayout={(event) => {
                          const next = event.nativeEvent.layout.height;
                          setScrollViewportHeight((prev) =>
                            prev === next ? prev : next
                          );
                        }}
                      >
                        <View collapsable={false} onLayout={rememberIntroLayout}>
                          <Text
                            style={[styles.subtitle, {
                              color: theme.colors.onSurfaceVariant,
                            }]}
                          >
                            Add them now and include them in expenses. Email is
                            optional.
                          </Text>
                        </View>
                        <View
                          collapsable={false}
                          onLayout={rememberFieldLayout("name")}
                        >
                          <TextInput
                            label="Name"
                            value={fullName}
                            onChangeText={setFullName}
                            onFocus={() => setFocusedField("name")}
                            mode="outlined"
                            autoCapitalize="words"
                            disabled={loading}
                            style={styles.input}
                            left={<TextInput.Icon icon="account" />}
                            placeholder="Ayaan"
                            testID="person-name-input"
                          />
                        </View>
                        {followerSpacer("email")}
                        <View
                          collapsable={false}
                          onLayout={rememberFieldLayout("email")}
                        >
                          <TextInput
                            label="Email (optional)"
                            value={email}
                            onChangeText={(value) => {
                              setEmail(value);
                              if (emailError) setEmailError(null);
                            }}
                            onFocus={() => setFocusedField("email")}
                            mode="outlined"
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoComplete="email"
                            disabled={loading}
                            error={!!emailError}
                            style={styles.input}
                            left={<TextInput.Icon icon="email" />}
                            placeholder="ayaan@example.com"
                            testID="person-email-input"
                            accessibilityHint={emailError || undefined}
                          />
                        </View>
                        {emailError
                          ? (
                            <Text
                              variant="bodySmall"
                              accessibilityLiveRegion="polite"
                              style={{
                                color: theme.colors.error,
                                marginTop: -8,
                                marginBottom: 12,
                                marginLeft: 12,
                              }}
                              testID="person-email-error"
                            >
                              {emailError}
                            </Text>
                          )
                          : null}
                        {followerSpacer("phone")}
                        <View
                          collapsable={false}
                          style={styles.phoneInputWrapper}
                          onLayout={rememberFieldLayout("phone")}
                        >
                          <Pressable
                            onPress={() => setShowCountryPicker(true)}
                            disabled={loading}
                            style={({ pressed }) => [
                              styles.countryCodeButton,
                              {
                                borderColor: theme.colors.outline,
                                backgroundColor: theme.colors.surfaceVariant,
                              },
                              pressed && styles.pressedRow,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`Country code ${selectedCountry.name} ${selectedCountry.dialCode}`}
                          >
                            <Text style={styles.countryFlag}>
                              {selectedCountry.flag}
                            </Text>
                            <Text
                              variant="bodyMedium"
                              style={{ color: theme.colors.onSurface }}
                            >
                              {selectedCountry.dialCode}
                            </Text>
                          </Pressable>
                          <TextInput
                            label="Phone (optional)"
                            value={phoneNumber}
                            onChangeText={(value) => {
                              setPhoneNumber(value);
                              if (phoneError) setPhoneError(null);
                            }}
                            onFocus={() => setFocusedField("phone")}
                            mode="outlined"
                            keyboardType="phone-pad"
                            autoComplete="tel"
                            disabled={loading}
                            error={!!phoneError}
                            style={[styles.input, styles.phoneInput]}
                            placeholder="98765 43210"
                            testID="person-phone-input"
                            accessibilityHint={phoneError || undefined}
                          />
                        </View>
                        {phoneError
                          ? (
                            <Text
                              variant="bodySmall"
                              accessibilityLiveRegion="polite"
                              style={{
                                color: theme.colors.error,
                                marginTop: -8,
                                marginBottom: 12,
                                marginLeft: 12,
                              }}
                              testID="person-phone-error"
                            >
                              {phoneError}
                            </Text>
                          )
                          : null}
                        {sheetFrame.keyboardOpen ? null : renderAddButton()}
                        <CountryCodePicker
                          visible={showCountryPicker}
                          onDismiss={() => setShowCountryPicker(false)}
                          onSelect={setSelectedCountry}
                          selectedCountry={selectedCountry}
                        />
                      </ScrollView>
                      {sheetFrame.keyboardOpen
                        ? (
                          <View
                            style={[styles.keyboardFooter, {
                              backgroundColor: theme.colors.surface,
                            }]}
                          >
                            {renderAddButton()}
                          </View>
                        )
                        : null}
                    </View>
                  )}
              </>
            )}
        </Animated.View>
      </View>
    </Modal>
  );
};

function ChoiceCard({
  icon,
  title,
  description,
  primary = false,
  onPress,
}: {
  icon: string;
  title: string;
  description: string;
  primary?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceCard,
        { borderColor: primary ? theme.colors.primary : theme.colors.outline },
        pressed && styles.pressedRow,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
    >
      <View
        style={[styles.choiceIcon, {
          backgroundColor: theme.colors.surfaceVariant,
        }]}
      >
        <Appbar.Action
          icon={icon}
          onPress={onPress}
          color={theme.colors.primary}
        />
      </View>
      <View style={styles.personText}>
        <Text variant="titleSmall">{title}</Text>
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant }}
        >
          {description}
        </Text>
      </View>
      <Appbar.Action icon="chevron-right" onPress={onPress} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, width: "100%", justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  sheet: {
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 5,
  },
  pickerSheet: {
    maxWidth: WEB_MAX_WIDTH,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  handleContainer: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { elevation: 0, backgroundColor: "transparent" },
  title: { fontWeight: "700" },
  chooserContent: { paddingHorizontal: 20, paddingBottom: 24 },
  formContent: { padding: 20, paddingBottom: 32 },
  subtitle: { textAlign: "center", marginBottom: 20 },
  choiceCard: {
    minHeight: 86,
    borderWidth: 1.5,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
  },
  dividerLine: { flex: 1 },
  linkHint: { textAlign: "center", marginTop: 10, fontSize: 12 },
  formColumn: { flex: 1, minHeight: 0 },
  formScroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  formContentWithFooter: { paddingBottom: 12 },
  keyboardFooter: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  input: { marginBottom: 16 },
  phoneInputWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  countryCodeButton: {
    minWidth: 92,
    height: 56,
    borderWidth: 1,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginRight: 8,
  },
  countryFlag: {
    fontSize: 18,
    lineHeight: 22,
  },
  phoneInput: {
    flex: 1,
    marginBottom: 0,
  },
  addButton: { marginTop: 8 },
  pickerContent: { flex: 1, minHeight: 0 },
  pickerList: { flex: 1, minHeight: 0 },
  pickerBody: { paddingHorizontal: 20 },
  sectionLabel: { marginTop: 24, marginBottom: 8 },
  peopleList: { paddingBottom: 32 },
  personRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128, 128, 128, 0.25)",
  },
  pressedRow: { opacity: 0.7 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  personText: { flex: 1, gap: 2 },
  loadingIndicator: { marginTop: 32 },
  emptyState: { padding: 32, gap: 12, alignItems: "center" },
});
