import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Appbar,
  Avatar,
  Button,
  Icon,
  Modal,
  Portal,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CountryCodePicker } from "../components/CountryCodePicker";
import { useAuth } from "../contexts/AuthContext";
import {
  ThemePreference,
  useThemePreference,
} from "../contexts/ThemePreferenceContext";
import { useCurrencyPreferences } from "../hooks/useCurrencyPreferences";
import { useDeleteAccount } from "../hooks/useDeleteAccount";
import { useProfile } from "../hooks/useProfile";
import { CURRENCIES, getCurrencyName } from "../utils/currency";
import { openAppExternalUrl } from "../utils/openAppExternalUrl";
import {
  setCachedNotificationPreference,
  useNotifications,
} from "../hooks/useNotifications";
import { disablePushNotifications, enablePushNotifications } from "../services/pushNotifications";
import {
  CountryCode,
  formatPhoneNumber,
  getCountryByCode,
  getDefaultCountry,
  parsePhoneNumber,
} from "../utils/countryCodes";
import { showErrorAlert } from "../utils/errorHandling";
import { isTransactionNotificationsEnabled } from "../utils/featureFlags";
import {
  buildSupportEmailUrl,
  SUPPORT_EMAIL,
  SUPPORT_TOPICS,
  type SupportTopic,
} from "../utils/supportEmail";

interface ProfileSetupScreenProps {
  onComplete: () => void;
  onBack?: () => void;
  onOpenCurrencyPreview?: () => void;
}

export const ProfileSetupScreen: React.FC<ProfileSetupScreenProps> = ({
  onComplete,
  onBack,
  onOpenCurrencyPreview,
}) => {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneNumber, setPhoneNumber] = useState(""); // Phone number without country code
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    getDefaultCountry()
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [supportSheetVisible, setSupportSheetVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notificationWorking, setNotificationWorking] = useState(false);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { resolvedTheme, setThemePreference, themePreference } =
    useThemePreference();
  const insets = useSafeAreaInsets();
  const { data: profile, updateProfile } = useProfile();
  const { preferredCurrency, setPreferredCurrency } = useCurrencyPreferences();
  const [showPreferredCurrencyPicker, setShowPreferredCurrencyPicker] = useState(false);
  const notifications = useNotifications();
  const notificationsEnabled =
    isTransactionNotificationsEnabled(notifications.data);
  const { signOut, user } = useAuth();
  const deleteAccount = useDeleteAccount();

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      const phoneValue = profile.phone || "";

      // Parse existing phone number to extract country code
      if (phoneValue) {
        const parsed = parsePhoneNumber(phoneValue);

        // If multiple countries share the same dial code (e.g., +1 for US and Canada),
        // use the country_code from the database if available
        if (parsed.possibleCountries.length > 1) {
          if (profile.country_code) {
            const savedCountry = parsed.possibleCountries.find(
              (c) => c.code === profile.country_code?.toUpperCase()
            );
            if (savedCountry) {
              setSelectedCountry(savedCountry);
            } else {
              // If saved country not in possible countries, use first one
              setSelectedCountry(parsed.possibleCountries[0]);
            }
          } else {
            // No country_code in DB, use first in list
            setSelectedCountry(parsed.possibleCountries[0]);
          }
        } else {
          // Only one country with this dial code, or use country_code from DB if available
          if (profile.country_code) {
            const country =
              parsed.possibleCountries.find(
                (c) => c.code === profile.country_code?.toUpperCase()
              ) || parsed.possibleCountries[0];
            setSelectedCountry(country);
          } else {
            setSelectedCountry(parsed.possibleCountries[0]);
          }
        }

        setPhoneNumber(parsed.number);
        setPhone(phoneValue);
      } else {
        // If no phone but country_code exists, use it
        if (profile.country_code) {
          const country = getCountryByCode(profile.country_code.toUpperCase());
          if (country) {
            setSelectedCountry(country);
          } else {
            setSelectedCountry(getDefaultCountry());
          }
        } else {
          setSelectedCountry(getDefaultCountry());
        }
        setPhoneNumber("");
        setPhone("");
      }
    }
  }, [profile]);

  // Update phone when phoneNumber or selectedCountry changes
  useEffect(() => {
    if (phoneNumber.trim()) {
      const formattedPhone = formatPhoneNumber(
        selectedCountry.dialCode,
        phoneNumber
      );
      setPhone(formattedPhone);
    } else {
      setPhone("");
    }
  }, [phoneNumber, selectedCountry]);

  // Check if there are any changes from the original profile
  const hasChanges = useMemo(() => {
    if (!profile) return false;
    const originalFullName = (profile.full_name || "").trim();
    const originalPhone = (profile.phone || "").trim();
    const originalCountryCode = (profile.country_code || "").toUpperCase();
    const currentFullName = fullName.trim();
    const currentPhone = phone.trim();
    const currentCountryCode = selectedCountry.code.toUpperCase();

    // Only consider country code changed if there is a phone number
    // This prevents "Save" from being enabled just because of the default country selection
    const countryChanged =
      currentPhone !== "" && originalCountryCode !== currentCountryCode;

    return (
      originalFullName !== currentFullName ||
      originalPhone !== currentPhone ||
      countryChanged
    );
  }, [profile, fullName, phone, selectedCountry]);

  const handleComplete = async () => {
    // Validation

    setLoading(true);
    try {
      await updateProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
        country_code: selectedCountry.code,
        profile_completed: true,
        preferred_currency: preferredCurrency,
      });
      onComplete();
    } catch (error) {
      showErrorAlert(error, signOut, "Error");
    } finally {
      setLoading(false);
    }
  };

  const handleThemePreferenceChange = async (value: string) => {
    const nextPreference = value as ThemePreference;

    try {
      await setThemePreference(nextPreference);
    } catch (error) {
      showErrorAlert(error, signOut, "Appearance");
    }
  };

  const handleEmailSupport = async (topic: SupportTopic) => {
    const mailtoUrl = buildSupportEmailUrl(topic, user?.email);

    try {
      await Linking.openURL(mailtoUrl);
      setSupportSheetVisible(false);
    } catch {
      Alert.alert(
        "Email Support",
        `Please email ${SUPPORT_EMAIL} from your registered email with the subject "SharedMoney support — ${topic.label}".`
      );
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account?",
      "Are you sure you want to delete your account? This action is permanent. Your profile details will be deleted, you will be removed from your groups, and your past shared expenses will be anonymized to maintain group ledger integrity.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAccount.mutateAsync();
            } catch (err) {
              const message =
                err instanceof Error
                  ? err.message
                  : "Could not delete your account. Please try again later.";
              Alert.alert("Error", message);
            }
          },
        },
      ]
    );
  };

  const getInitials = () => {
    if (fullName.trim()) {
      const names = fullName.trim().split(" ");
      if (names.length >= 2) {
        return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
      }
      return fullName.trim()[0].toUpperCase();
    }
    return "?";
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.background },
        { paddingTop: 0 }, // Appbar handles top padding
        { paddingBottom: insets.bottom },
      ]}
    >
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        {onBack ? (
          <>
            <Appbar.BackAction onPress={onBack} />
            <Appbar.Content
              title="Edit Profile"
              titleStyle={{ fontWeight: "bold" }}
            />
          </>
        ) : (
          <Appbar.Content title="Profile" titleStyle={{ fontWeight: "bold" }} />
        )}
        <Appbar.Action
          icon="logout"
          iconColor={theme.colors.error}
          onPress={() => {
            // Ensure async function is properly called
            void signOut();
          }}
          testID="logout-button"
        />
      </Appbar.Header>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View
              style={[
                styles.avatarContainer,
                { backgroundColor: theme.colors.primaryContainer },
              ]}
            >
              <Avatar.Text
                size={80}
                label={getInitials()}
                style={{ backgroundColor: theme.colors.primary }}
              />
            </View>
            <Text
              variant="headlineSmall"
              style={[styles.title, { color: theme.colors.onSurface }]}
            >
              {fullName || "Your Profile"}
            </Text>
            <Text
              variant="bodyMedium"
              style={[
                styles.subtitle,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              Update your personal details
            </Text>
          </View>

          <Surface
            style={[styles.formCard, { backgroundColor: theme.colors.surface }]}
            elevation={2}
          >
            <TextInput
              label="Email"
              value={user?.email || ""}
              mode="outlined"
              disabled
              style={[styles.input, { opacity: 0.7 }]}
              left={<TextInput.Icon icon="email" />}
            />

            <TextInput
              label="Full Name"
              value={fullName}
              onChangeText={setFullName}
              mode="outlined"
              disabled={loading}
              style={styles.input}
              left={<TextInput.Icon icon="account" />}
              placeholder="Enter your full name"
              autoCapitalize="words"
            />

            <View style={styles.phoneInputWrapper}>
              <TouchableOpacity
                onPress={() => setShowCountryPicker(true)}
                disabled={loading}
                activeOpacity={0.7}
                style={[
                  styles.countryCodeSelector,
                  {
                    borderRightColor: theme.colors.outline,
                    backgroundColor: theme.colors.surfaceVariant,
                    borderColor: theme.colors.outline,
                  },
                ]}
              >
                <Text style={styles.flag}>{selectedCountry.flag}</Text>
                <Text
                  variant="bodySmall"
                  style={[
                    styles.dialCodeText,
                    { color: theme.colors.onSurface },
                  ]}
                >
                  {selectedCountry.dialCode}
                </Text>
                <Icon source="chevron-down" size={18} />
              </TouchableOpacity>
              <TextInput
                label="Phone Number (Optional)"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                mode="outlined"
                disabled={loading}
                style={[styles.input, styles.phoneInput]}
                placeholder="Enter your phone number"
                keyboardType="phone-pad"
                contentStyle={styles.phoneInputContent}
              />
            </View>

            <View style={styles.appearanceSection}>
              <View style={styles.appearanceHeader}>
                <View>
                  <Text
                    variant="titleSmall"
                    style={[
                      styles.appearanceTitle,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    Appearance
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    System is using {resolvedTheme} mode
                  </Text>
                </View>
              </View>
              <SegmentedButtons
                value={themePreference}
                onValueChange={handleThemePreferenceChange}
                theme={{
                  colors: {
                    secondaryContainer: theme.colors.primaryContainer,
                    onSecondaryContainer: theme.colors.onPrimaryContainer,
                  },
                }}
                buttons={[
                  {
                    value: "system",
                    label: "System",
                    icon: "theme-light-dark",
                  },
                  {
                    value: "light",
                    label: "Light",
                    icon: "white-balance-sunny",
                  },
                  {
                    value: "dark",
                    label: "Dark",
                    icon: "moon-waning-crescent",
                  },
                ]}
                style={styles.themeButtons}
              />
            </View>

            <View
              style={[
                styles.notificationSetting,
                { borderTopColor: theme.colors.outlineVariant },
              ]}
            >
              <View style={styles.notificationSettingCopy}>
                <Text
                  variant="titleSmall"
                  style={{ color: theme.colors.onSurface, fontWeight: "700" }}
                >
                  Preferred currency
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Used for your personal totals. Groups can still settle in another currency.
                </Text>
              </View>
              <Button
                mode="outlined"
                compact
                onPress={() => setShowPreferredCurrencyPicker(true)}
                testID="preferred-currency-button"
              >
                {preferredCurrency}
              </Button>
            </View>

            {onOpenCurrencyPreview ? (
              <Button
                mode="text"
                icon="eye-outline"
                onPress={onOpenCurrencyPreview}
                style={{ alignSelf: "flex-start", marginBottom: 8 }}
                testID="currency-merge-preview-button"
              >
                Preview unified balances
              </Button>
            ) : null}

            {notificationsEnabled ? (
              <View
                style={[
                  styles.notificationSetting,
                  { borderTopColor: theme.colors.outlineVariant },
                ]}
              >
                <View style={styles.notificationSettingCopy}>
                  <Text
                    variant="titleSmall"
                    style={{ color: theme.colors.onSurface, fontWeight: "700" }}
                  >
                    Push notifications
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {Platform.OS === "web"
                      ? "Available in the iOS and Android apps"
                      : notifications.data?.preference.permission_status === "denied"
                        ? "Permission is off. Your device settings may be required."
                        : "Expense changes that affect you"}
                  </Text>
                </View>
                <Switch
                  value={notifications.data?.preference.push_enabled ?? false}
                  disabled={Platform.OS === "web" || notificationWorking}
                  onValueChange={async (enabled) => {
                    setNotificationWorking(true);
                    try {
                      const preference = enabled
                        ? await enablePushNotifications()
                        : await disablePushNotifications();
                      if (user?.id) {
                        setCachedNotificationPreference(
                          queryClient,
                          user.id,
                          preference
                        );
                      }
                      if (enabled && !preference.push_enabled) {
                        if (preference.permission_status === "denied") {
                          Alert.alert(
                            "Notifications are off",
                            "Allow notifications in your device settings, then return to ShareMoney.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Open Settings",
                                onPress: () => void Linking.openSettings(),
                              },
                            ]
                          );
                        } else {
                          Alert.alert(
                            "Notifications are unavailable",
                            "Push notifications aren’t available on this device."
                          );
                        }
                      }
                    } catch (error) {
                      showErrorAlert(error, signOut, "Notifications");
                    } finally {
                      setNotificationWorking(false);
                    }
                  }}
                  accessibilityLabel="Push notifications"
                />
              </View>
            ) : null}

            <Button
              mode="contained"
              onPress={handleComplete}
              disabled={loading || !hasChanges}
              loading={loading}
              style={styles.button}
              contentStyle={styles.buttonContent}
            >
              Save Changes
            </Button>
          </Surface>

          <Surface
            style={[
              styles.supportCard,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
            elevation={0}
          >
            <View style={styles.supportHeader}>
              <Icon
                source="email-outline"
                size={22}
                color={theme.colors.onSurfaceVariant}
              />
              <View style={styles.supportText}>
                <Text
                  variant="titleSmall"
                  style={{ color: theme.colors.onSurface }}
                >
                  Get help
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Contact SharedMoney support for any issue.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Email SharedMoney support"
              accessibilityHint="Choose a support topic before opening an email"
              disabled={loading}
              onPress={() => setSupportSheetVisible(true)}
              style={[
                styles.supportButton,
                {
                  borderColor: theme.colors.outline,
                  backgroundColor: theme.colors.surface,
                },
                loading && styles.supportButtonDisabled,
              ]}
            >
              <Text
                variant="labelLarge"
                style={{ color: theme.colors.onSurface, fontWeight: "700" }}
              >
                Email support
              </Text>
              <Icon
                source="chevron-right"
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
          </Surface>

          <Surface
            style={[
              styles.supportCard,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
            elevation={0}
          >
            <View style={styles.supportHeader}>
              <Icon
                source="shield-check-outline"
                size={22}
                color={theme.colors.onSurfaceVariant}
              />
              <View style={styles.supportText}>
                <Text
                  variant="titleSmall"
                  style={{ color: theme.colors.onSurface }}
                >
                  Legal
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Review the terms and privacy policy that protect your data.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="View Terms of Use"
              onPress={() => {
                void openAppExternalUrl("https://sharedmoney.app/terms");
              }}
              style={[
                styles.supportButton,
                {
                  borderColor: theme.colors.outline,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <Text
                variant="labelLarge"
                style={{ color: theme.colors.onSurface, fontWeight: "700" }}
              >
                Terms of Use
              </Text>
              <Icon
                source="open-in-new"
                size={18}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="View Privacy Policy"
              onPress={() => {
                void openAppExternalUrl("https://sharedmoney.app/privacy");
              }}
              style={[
                styles.supportButton,
                {
                  borderColor: theme.colors.outline,
                  backgroundColor: theme.colors.surface,
                  marginTop: 8,
                },
              ]}
            >
              <Text
                variant="labelLarge"
                style={{ color: theme.colors.onSurface, fontWeight: "700" }}
              >
                Privacy Policy
              </Text>
              <Icon
                source="open-in-new"
                size={18}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
          </Surface>

          <Surface
            style={[
              styles.supportCard,
              { backgroundColor: theme.colors.surfaceVariant, marginBottom: 32 },
            ]}
            elevation={0}
          >
            <View style={styles.supportHeader}>
              <Icon
                source="alert-circle-outline"
                size={22}
                color={theme.colors.error}
              />
              <View style={styles.supportText}>
                <Text
                  variant="titleSmall"
                  style={{ color: theme.colors.error }}
                >
                  Account Actions
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Permanently delete your SharedMoney account and data.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete your SharedMoney account"
              accessibilityHint="Permanently closes your account and removes personal data"
              disabled={deleteAccount.isPending || loading}
              onPress={handleDeleteAccount}
              style={[
                styles.supportButton,
                {
                  borderColor: theme.colors.error,
                  backgroundColor: theme.colors.surface,
                },
                (deleteAccount.isPending || loading) && styles.supportButtonDisabled,
              ]}
            >
              <Text
                variant="labelLarge"
                style={{ color: theme.colors.error, fontWeight: "700" }}
              >
                {deleteAccount.isPending ? "Deleting account..." : "Delete Account"}
              </Text>
              <Icon
                source="delete-outline"
                size={20}
                color={theme.colors.error}
              />
            </Pressable>
          </Surface>
        </ScrollView>
      </KeyboardAvoidingView>

      <CountryCodePicker
        visible={showCountryPicker}
        onDismiss={() => setShowCountryPicker(false)}
        onSelect={setSelectedCountry}
        selectedCountry={selectedCountry}
      />
      <Portal>
        <Modal
          visible={showPreferredCurrencyPicker}
          onDismiss={() => setShowPreferredCurrencyPicker(false)}
          contentContainerStyle={[
            styles.currencyPickerModal,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <Text variant="titleMedium" style={{ fontWeight: "700", marginBottom: 8 }}>
            Preferred currency
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}
          >
            Used for your personal totals. Groups can still settle in another currency.
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {CURRENCIES.slice(0, 24).map((item) => {
              const selected = item.code === preferredCurrency;
              return (
                <Pressable
                  key={item.code}
                  onPress={() => {
                    void setPreferredCurrency(item.code);
                    setShowPreferredCurrencyPicker(false);
                  }}
                  style={[
                    styles.currencyOption,
                    selected && { backgroundColor: theme.colors.primaryContainer },
                  ]}
                >
                  <View>
                    <Text variant="bodyLarge">{item.code} ({item.symbol})</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {getCurrencyName(item.code)}
                    </Text>
                  </View>
                  {selected ? (
                    <Icon source="check" size={20} color={theme.colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Modal>
      </Portal>
      <Portal>
        <Modal
          visible={supportSheetVisible}
          onDismiss={() => setSupportSheetVisible(false)}
          style={styles.supportModal}
          contentContainerStyle={[
            styles.supportModalContent,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 20),
            },
          ]}
        >
          <View style={styles.supportSheetHandle} />
          <Text
            variant="titleMedium"
            style={{ color: theme.colors.onSurface, fontWeight: "700" }}
          >
            What do you need help with?
          </Text>
          <Text
            variant="bodySmall"
            style={[
              styles.supportSheetSubtitle,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            We’ll open an email with the right subject.
          </Text>
          <View>
            {SUPPORT_TOPICS.map((topic) => (
              <Pressable
                key={topic.id}
                accessibilityRole="button"
                accessibilityLabel={`Email support about ${topic.label}`}
                onPress={() => void handleEmailSupport(topic)}
                style={({ pressed }) => [
                  styles.supportTopic,
                  {
                    borderBottomColor: theme.colors.outlineVariant,
                    backgroundColor: pressed
                      ? theme.colors.surfaceVariant
                      : "transparent",
                  },
                ]}
              >
                <Icon
                  source={topic.icon}
                  size={22}
                  color={theme.colors.primary}
                />
                <View style={styles.supportTopicText}>
                  <Text
                    variant="bodyMedium"
                    style={{ color: theme.colors.onSurface, fontWeight: "600" }}
                  >
                    {topic.label}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {topic.description}
                  </Text>
                </View>
                <Icon
                  source="chevron-right"
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>
            ))}
          </View>
          <Button onPress={() => setSupportSheetVisible(false)}>Cancel</Button>
        </Modal>
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  header: {
    alignItems: "center",
    marginBottom: 24,
    marginTop: 16,
  },
  avatarContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  title: {
    fontWeight: "bold",
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
  },
  formCard: {
    borderRadius: 16,
    padding: 16,
    paddingVertical: 24,
  },
  input: {
    marginBottom: 16,
    backgroundColor: "transparent",
  },
  phoneInputWrapper: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "flex-start",
    position: "relative",
  },
  countryCodeSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderRightWidth: 1,
    borderTopLeftRadius: 16, // Match theme roundness
    borderBottomLeftRadius: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    minWidth: 100,
    height: 56, // Match TextInput height
    marginTop: 8, // Account for label
    gap: 6,
  },
  flag: {
    fontSize: 20,
  },
  dialCodeText: {
    fontWeight: "600",
    fontSize: 15,
    letterSpacing: 0.2,
  },
  chevronIcon: {
    margin: 0,
    opacity: 0.6,
  },
  phoneInput: {
    flex: 1,
    marginBottom: 0,
    marginLeft: -1, // Overlap border to connect with country selector
  },
  phoneInputContent: {
    paddingLeft: 12,
    paddingRight: 12,
  },
  appearanceSection: {
    gap: 12,
    marginBottom: 16,
  },
  appearanceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  appearanceTitle: {
    fontWeight: "700",
    marginBottom: 2,
  },
  notificationSetting: {
    minHeight: 72,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    marginBottom: 16,
  },
  notificationSettingCopy: {
    flex: 1,
    paddingRight: 16,
    gap: 3,
  },
  themeButtons: {
    width: "100%",
  },
  button: {
    marginTop: 8,
    borderRadius: 8,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  supportCard: {
    borderRadius: 16,
    marginTop: 16,
    padding: 16,
  },
  supportHeader: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  supportText: {
    flex: 1,
    gap: 4,
  },
  supportButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  supportButtonDisabled: {
    opacity: 0.6,
  },
  supportModal: {
    justifyContent: "flex-end",
    margin: 0,
  },
  supportModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  supportSheetHandle: {
    alignSelf: "center",
    backgroundColor: "#D0D5DD",
    borderRadius: 2,
    height: 4,
    marginBottom: 20,
    width: 36,
  },
  supportSheetSubtitle: {
    marginBottom: 12,
    marginTop: 4,
  },
  supportTopic: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 4,
  },
  supportTopicText: {
    flex: 1,
    gap: 2,
  },
  currencyPickerModal: {
    margin: 24,
    borderRadius: 20,
    padding: 20,
    maxHeight: "80%",
  },
  currencyOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
});
