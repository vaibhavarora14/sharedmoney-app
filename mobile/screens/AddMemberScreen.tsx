import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
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
import { CountryCodePicker } from "../components/CountryCodePicker";
import { useAuth } from "../contexts/AuthContext";
import { useCreateGroupShareLink } from "../hooks/useGroupInvitations";
import { useExistingPeople } from "../hooks/useParticipants";
import { useProfile } from "../hooks/useProfile";
import { getInviteLinkUrl } from "../utils/inviteLinks";
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

interface AddMemberScreenProps {
  visible: boolean;
  groupId: string;
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

const LINK_MAX_USES = 10;
const LINK_VALID_DAYS = 30;

export const AddMemberScreen: React.FC<AddMemberScreenProps> = ({
  visible,
  groupId,
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
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
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

  const handleDismiss = () => {
    setMode("chooser");
    setFullName("");
    setEmail("");
    setEmailError(null);
    setPhoneNumber("");
    setPhoneError(null);
    setShowCountryPicker(false);
    setSearch("");
    setInviteLink(null);
    onDismiss();
  };

  const generateInviteLink = async (): Promise<string> => {
    if (inviteLink) return inviteLink;
    const token = await createShareLink.mutateAsync({
      groupId,
      maxUses: LINK_MAX_USES,
      validDays: LINK_VALID_DAYS,
    });
    const url = getInviteLinkUrl(token);
    setInviteLink(url);
    captureIdentifiedAnalyticsEvent(
      user?.id,
      ANALYTICS_EVENTS.INVITE_LINK_CREATED,
      {
        group_id: groupId,
        invite_type: "share_link",
        max_uses: LINK_MAX_USES,
        valid_days: LINK_VALID_DAYS,
      },
    );
    return url;
  };

  const handleShareLink = async () => {
    setLoading(true);
    try {
      const url = await generateInviteLink();
      let shared = false;
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({
            title: "Join my group on SharedMoney!",
            text: `Join my group on SharedMoney! ${url}`,
            url,
          });
          shared = true;
        } else if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          Alert.alert(
            "Invite link copied",
            "Share it with the people you want to invite.",
          );
          shared = true;
        }
      } else {
        await Share.share({
          message: `Join my group on SharedMoney! ${url}`,
          url,
        });
        shared = true;
      }
      if (shared) {
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
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: "Join my group on SharedMoney!",
          text: `Join my group on SharedMoney! ${url}`,
          url,
        });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        Alert.alert(
          "Invite link copied",
          "Share it by SMS, WhatsApp, or any app you prefer.",
        );
        return;
      }
    }

    await Share.share({
      message: `Join my group on SharedMoney! ${url}`,
      url,
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
  const bottomSheetHeight = isExistingPicker
    ? screenHeight
    : Math.min(screenHeight * 0.64, 560);
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
              paddingBottom: insets.bottom,
              paddingTop: isExistingPicker ? insets.top : 0,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          {isExistingPicker
            ? (
              <View style={styles.pickerContent}>
                <Appbar.Header style={styles.header}>
                  <Appbar.BackAction onPress={() => setMode("chooser")} />
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
                    <Appbar.BackAction onPress={() => setMode("chooser")} />
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
                        {`Send a link — up to ${LINK_MAX_USES} people · valid ${LINK_VALID_DAYS} days`}
                      </Text>
                    </View>
                  )
                  : (
                    <KeyboardAvoidingView
                      behavior={Platform.OS === "ios" ? "padding" : "height"}
                      style={styles.keyboardView}
                    >
                      <ScrollView
                        contentContainerStyle={styles.formContent}
                        keyboardShouldPersistTaps="handled"
                      >
                        <Text
                          style={[styles.subtitle, {
                            color: theme.colors.onSurfaceVariant,
                          }]}
                        >
                          Add them now and include them in expenses. Email is
                          optional.
                        </Text>
                        <TextInput
                          label="Name"
                          value={fullName}
                          onChangeText={setFullName}
                          mode="outlined"
                          autoCapitalize="words"
                          disabled={loading}
                          style={styles.input}
                          left={<TextInput.Icon icon="account" />}
                          placeholder="Ayaan"
                          testID="person-name-input"
                        />
                        <TextInput
                          label="Email (optional)"
                          value={email}
                          onChangeText={(value) => {
                            setEmail(value);
                            if (emailError) setEmailError(null);
                          }}
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
                        <View style={styles.phoneInputWrapper}>
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
                        <CountryCodePicker
                          visible={showCountryPicker}
                          onDismiss={() => setShowCountryPicker(false)}
                          onSelect={setSelectedCountry}
                          selectedCountry={selectedCountry}
                        />
                      </ScrollView>
                    </KeyboardAvoidingView>
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
  keyboardView: { flex: 1 },
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
  pickerContent: { flex: 1 },
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
