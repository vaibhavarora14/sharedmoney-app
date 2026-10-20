import * as AppleAuthentication from "expo-apple-authentication";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  Button,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { CountryCodePicker } from "../components/CountryCodePicker";
import { isAuthDesktopWebViewport } from "../constants/layout";
import { useAuth } from "../contexts/AuthContext";
import {
  CountryCode,
  countryCodes,
  getCountryByCode,
} from "../utils/countryCodes";
import {
  formatE164ForDisplay,
  formatResendCountdown,
  WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS,
} from "../utils/phoneDisplay";
import {
  DEFAULT_PHONE_COUNTRY_CODE,
  normalizePhoneToE164,
} from "../utils/phoneValidation";
import { sendWhatsAppOtp } from "../utils/whatsappOtpApi";
import { isWhatsAppOtpLoginEnabled } from "../utils/whatsappOtpLogin";

type AuthStep = "methods" | "email" | "phone" | "otp";
type WhatsAppLoadingKind = "send" | "verify" | null;

const PHONE_FIELD_HEIGHT = 56;
const PHONE_FIELD_RADIUS = 4;
const OTP_CODE_LENGTH = 6;

interface AuthScreenProps {
  onToggleMode: () => void;
  isSignUp: boolean;
  /** Design-review only. Never set from production App.tsx. */
  previewInitialStep?: AuthStep;
  /** Design-review only. Seeds the OTP screen phone label. */
  previewPhoneE164?: string;
  /** Design-review only. Seeds error copy on phone/OTP screens. */
  previewFormError?: string | null;
  /** Design-review only. Locks a send/verify button loading label. */
  previewWhatsAppLoading?: WhatsAppLoadingKind;
  /** Design-review only. Seeds resend cooldown seconds. */
  previewResendSeconds?: number;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onToggleMode,
  isSignUp,
  previewInitialStep,
  previewPhoneE164,
  previewFormError = null,
  previewWhatsAppLoading = null,
  previewResendSeconds,
}) => {
  const whatsappOtpEnabled = isWhatsAppOtpLoginEnabled();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNational, setPhoneNational] = useState(
    previewInitialStep === "phone" || previewInitialStep === "otp" ? "9876543210" : "",
  );
  const [otpCode, setOtpCode] = useState("");
  const [phoneE164, setPhoneE164] = useState<string | null>(
    previewPhoneE164 ?? null,
  );
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    () =>
      getCountryByCode(DEFAULT_PHONE_COUNTRY_CODE) ??
      countryCodes.find((c) => c.code === "IN") ??
      countryCodes[0],
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>(
    previewInitialStep && whatsappOtpEnabled ? previewInitialStep : "methods",
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [whatsappLoading, setWhatsappLoading] = useState<WhatsAppLoadingKind>(
    previewWhatsAppLoading,
  );
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(previewFormError);
  const [resendSeconds, setResendSeconds] = useState(
    previewResendSeconds ??
      (previewInitialStep === "otp" ? WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS : 0),
  );
  const emailInputRef = useRef<any>(null);
  const phoneInputRef = useRef<any>(null);
  const otpInputRef = useRef<any>(null);
  const otpSubmitLockRef = useRef(false);
  const { signIn, signUp, signInWithGoogle, signInWithApple, signInWithWhatsAppOtp } =
    useAuth();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isDesktopWeb = isAuthDesktopWebViewport(Platform.OS, width);
  const socialLoading = googleLoading || appleLoading || Boolean(whatsappLoading);
  const formDisabled = loading || socialLoading;
  const sendButtonLabel =
    whatsappLoading === "send" ? "Sending…" : "Send WhatsApp code";
  const verifyButtonLabel =
    whatsappLoading === "verify" ? "Verifying…" : "Verify and continue";
  const displayedPhone = phoneE164
    ? formatE164ForDisplay(phoneE164)
    : "your WhatsApp";
  const emailInvalid = Boolean(formError && formError.toLowerCase().includes("email"));
  const passwordInvalid = Boolean(
    formError && formError.toLowerCase().includes("password")
  );
  const accountPrompt = isSignUp
    ? "Already have an account?"
    : "New to SharedMoney?";
  const accountAction = isSignUp ? "Sign In" : "Create account";

  useEffect(() => {
    let mounted = true;

    if (Platform.OS !== "ios") {
      setAppleSignInAvailable(false);
      return () => {
        mounted = false;
      };
    }

    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) {
          setAppleSignInAvailable(available);
        }
      })
      .catch(() => {
        if (mounted) {
          setAppleSignInAvailable(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (authStep === "email") {
      const focusTimer = setTimeout(() => emailInputRef.current?.focus(), 0);
      return () => clearTimeout(focusTimer);
    }
    if (authStep === "phone") {
      const focusTimer = setTimeout(() => phoneInputRef.current?.focus(), 0);
      return () => clearTimeout(focusTimer);
    }
    if (authStep === "otp") {
      const focusTimer = setTimeout(() => otpInputRef.current?.focus(), 0);
      return () => clearTimeout(focusTimer);
    }
  }, [authStep]);

  useEffect(() => {
    // Freeze countdown when a design-review preview seeds a fixed value.
    if (previewResendSeconds != null) return;
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [previewResendSeconds, resendSeconds]);

  const clearFormError = () => {
    if (formError) setFormError(null);
  };

  const showEmailForm = () => {
    clearFormError();
    setAuthStep("email");
  };

  const showPhoneForm = () => {
    clearFormError();
    setOtpCode("");
    setAuthStep("phone");
  };

  const showMethods = () => {
    Keyboard.dismiss();
    clearFormError();
    setOtpCode("");
    setAuthStep("methods");
  };

  const toggleMode = () => {
    clearFormError();
    onToggleMode();
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    setFormError(null);

    if (!trimmedEmail) {
      setFormError("Enter your email address.");
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError("Enter a valid email address.");
      return;
    }

    if (!password.trim()) {
      setFormError("Enter your password.");
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const result = isSignUp
        ? await signUp(trimmedEmail, password)
        : await signIn(trimmedEmail, password);

      if (result.error) {
        const errorMessage = result.error.message || "An error occurred";
        const errorTitle = isSignUp ? "Sign Up Failed" : "Sign In Failed";
        setFormError(errorMessage);
        Alert.alert(errorTitle, errorMessage, [{ text: "OK", style: "default" }]);
      }
    } catch (err) {
      console.error("Unexpected error in authentication:", err);
      Alert.alert("Error", "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        Alert.alert("Google Sign In Failed", error.message || "Failed to sign in with Google", [
          { text: "OK", style: "default" },
        ]);
      }
    } catch (err) {
      console.error("Error in Google sign in:", err);
      Alert.alert("Error", "An unexpected error occurred. Please try again.", [
        { text: "OK", style: "default" },
      ]);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    try {
      const { error } = await signInWithApple();
      if (error) {
        Alert.alert("Apple Sign In Failed", error.message || "Failed to sign in with Apple", [
          { text: "OK", style: "default" },
        ]);
      }
    } catch (err) {
      console.error("Error in Apple sign in:", err);
      Alert.alert("Error", "An unexpected error occurred. Please try again.", [
        { text: "OK", style: "default" },
      ]);
    } finally {
      setAppleLoading(false);
    }
  };

  const handleSendWhatsAppOtp = async () => {
    if (whatsappLoading) return;
    clearFormError();
    const normalized = normalizePhoneToE164(
      phoneNational,
      selectedCountry.code,
    );
    if (!normalized) {
      setFormError("Enter a valid phone number with country code.");
      return;
    }

    setWhatsappLoading("send");
    try {
      const result = await sendWhatsAppOtp(normalized);
      setPhoneE164(normalized);
      setResendSeconds(
        result.resend_after || WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS,
      );
      setAuthStep("otp");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not send WhatsApp code.";
      setFormError(message);
      Alert.alert("WhatsApp code", message, [{ text: "OK", style: "default" }]);
    } finally {
      setWhatsappLoading(null);
    }
  };

  const handleVerifyWhatsAppOtp = async (codeOverride?: string) => {
    if (whatsappLoading || otpSubmitLockRef.current) return;
    clearFormError();
    if (!phoneE164) {
      setFormError("Request a new code and try again.");
      setAuthStep("phone");
      return;
    }
    const trimmed = (codeOverride ?? otpCode).trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setFormError("Enter the 6-digit code from WhatsApp.");
      return;
    }

    otpSubmitLockRef.current = true;
    setWhatsappLoading("verify");
    try {
      const { error } = await signInWithWhatsAppOtp(phoneE164, trimmed);
      if (error) {
        setFormError(error.message || "Incorrect code. Try again.");
        Alert.alert(
          "WhatsApp sign-in failed",
          error.message || "Incorrect code. Try again.",
          [{ text: "OK", style: "default" }],
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setFormError(message);
    } finally {
      otpSubmitLockRef.current = false;
      setWhatsappLoading(null);
    }
  };

  const handleOtpCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH);
    setOtpCode(digits);
    clearFormError();
    if (digits.length === OTP_CODE_LENGTH) {
      void handleVerifyWhatsAppOtp(digits);
    }
  };

  const handleResendWhatsAppOtp = async () => {
    if (resendSeconds > 0 || !phoneE164 || whatsappLoading) return;
    setWhatsappLoading("send");
    clearFormError();
    try {
      const result = await sendWhatsAppOtp(phoneE164);
      setResendSeconds(
        result.resend_after || WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not resend code.";
      setFormError(message);
    } finally {
      setWhatsappLoading(null);
    }
  };

  const renderLogo = (size: "compact" | "desktop") => (
    <Image
      source={require("../assets/logo.png")}
      style={size === "desktop" ? styles.desktopLogo : styles.logo}
      resizeMode="contain"
      accessibilityLabel="SharedMoney app icon"
    />
  );

  const renderAccountToggle = () => (
    <View style={styles.accountToggle}>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {accountPrompt}{" "}
      </Text>
      <Button
        mode="text"
        compact
        onPress={toggleMode}
        disabled={formDisabled}
        contentStyle={styles.accountToggleButtonContent}
        labelStyle={styles.accountToggleButtonLabel}
      >
        {accountAction}
      </Button>
    </View>
  );

  const renderMethods = () => (
    <View style={styles.methodScreen}>
      {!isDesktopWeb ? renderLogo("compact") : null}
      <Text variant="headlineSmall" style={[styles.methodTitle, { color: theme.colors.onBackground }]}>
        {isSignUp ? "Create your account" : "Log in to SharedMoney"}
      </Text>

      <View style={styles.methodStack}>
        {appleSignInAvailable ? (
          <View
            pointerEvents={formDisabled ? "none" : "auto"}
            style={[
              styles.appleButtonContainer,
              formDisabled && styles.disabledSocialButton,
            ]}
          >
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
              }
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={8}
              onPress={handleAppleSignIn}
              style={styles.appleButton}
              accessibilityLabel="Continue with Apple"
            />
          </View>
        ) : null}

        <Button
          mode="contained"
          icon="google"
          onPress={handleGoogleSignIn}
          disabled={formDisabled}
          loading={googleLoading}
          style={styles.methodButton}
          contentStyle={styles.methodButtonContent}
        >
          Continue with Google
        </Button>

        <Button
          mode="outlined"
          onPress={showEmailForm}
          disabled={formDisabled}
          style={styles.methodButton}
          contentStyle={styles.methodButtonContent}
        >
          Continue with email
        </Button>

        {whatsappOtpEnabled ? (
          <Button
            mode="outlined"
            icon="whatsapp"
            onPress={showPhoneForm}
            disabled={formDisabled}
            style={styles.methodButton}
            contentStyle={styles.methodButtonContent}
            accessibilityLabel="Continue with WhatsApp"
          >
            Continue with WhatsApp
          </Button>
        ) : null}
      </View>

      {renderAccountToggle()}
    </View>
  );

  const renderEmailForm = () => (
    <View style={styles.emailScreen}>
      <Button
        mode="text"
        icon="arrow-left"
        onPress={showMethods}
        disabled={formDisabled}
        style={styles.backButton}
        contentStyle={styles.backButtonContent}
      >
        All sign-in methods
      </Button>

      <Text variant="headlineSmall" style={[styles.emailTitle, { color: theme.colors.onBackground }]}>
        {isSignUp ? "Create your account" : "Log in with email"}
      </Text>

      <TextInput
        ref={emailInputRef}
        label="Email"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          clearFormError();
        }}
        mode="outlined"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        accessibilityLabel="Email"
        accessibilityHint="Enter the email address for your SharedMoney account"
        aria-describedby={formError ? "auth-form-error" : undefined}
        aria-invalid={emailInvalid || undefined}
        disabled={formDisabled}
        error={emailInvalid}
        style={styles.input}
      />

      <TextInput
        label="Password"
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          clearFormError();
        }}
        mode="outlined"
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoComplete="password"
        textContentType={isSignUp ? "newPassword" : "password"}
        accessibilityLabel="Password"
        accessibilityHint="Enter your SharedMoney password"
        aria-describedby={formError ? "auth-form-error" : undefined}
        aria-invalid={passwordInvalid || undefined}
        disabled={formDisabled}
        error={passwordInvalid}
        style={styles.input}
        right={
          <TextInput.Icon
            icon={showPassword ? "eye-off" : "eye"}
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            forceTextInputFocus={false}
            onPress={() => setShowPassword(!showPassword)}
          />
        }
      />

      {formError ? (
        <Text
          nativeID="auth-form-error"
          accessibilityRole="alert"
          variant="bodyMedium"
          style={[styles.formError, { color: theme.colors.error }]}
        >
          {formError}
        </Text>
      ) : null}

      <Button
        mode="contained"
        onPress={handleSubmit}
        disabled={formDisabled}
        loading={loading}
        style={styles.methodButton}
        contentStyle={styles.methodButtonContent}
      >
        {isSignUp ? "Create account" : "Sign In"}
      </Button>

      {renderAccountToggle()}
    </View>
  );

  const renderPhoneForm = () => (
    <View style={styles.emailScreen} testID="auth-whatsapp-phone">
      <Button
        mode="text"
        icon="arrow-left"
        onPress={showMethods}
        disabled={formDisabled}
        style={styles.backButton}
        contentStyle={styles.backButtonContent}
      >
        All sign-in methods
      </Button>

      <Text variant="headlineSmall" style={[styles.emailTitle, { color: theme.colors.onBackground }]}>
        Continue with WhatsApp
      </Text>
      <Text
        variant="bodyMedium"
        style={[styles.phoneHint, { color: theme.colors.onSurfaceVariant }]}
      >
        We’ll send a one-time code to your WhatsApp number.
      </Text>

      <Text
        variant="labelLarge"
        style={[styles.fieldLabel, { color: theme.colors.onSurface }]}
      >
        Phone number
      </Text>
      <View style={styles.phoneRow}>
        <Pressable
          onPress={() => setShowCountryPicker(true)}
          disabled={formDisabled}
          style={[
            styles.countryButton,
            {
              borderColor: formError ? theme.colors.error : theme.colors.outline,
              backgroundColor: theme.colors.surface,
            },
          ]}
          accessibilityLabel={`Country code ${selectedCountry.name} ${selectedCountry.dialCode}`}
        >
          <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>
            {selectedCountry.flag} {selectedCountry.dialCode}
          </Text>
        </Pressable>
        <View
          style={[
            styles.phoneInputShell,
            {
              borderColor: formError ? theme.colors.error : theme.colors.outline,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <RNTextInput
            ref={phoneInputRef}
            value={phoneNational}
            onChangeText={(value) => {
              setPhoneNational(value);
              clearFormError();
            }}
            placeholder="Phone number"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            accessibilityLabel="Phone number"
            editable={!formDisabled}
            style={[
              styles.phoneInput,
              { color: theme.colors.onSurface },
            ]}
          />
        </View>
      </View>

      {formError ? (
        <Text
          accessibilityRole="alert"
          variant="bodyMedium"
          style={[styles.formError, { color: theme.colors.error }]}
        >
          {formError}
        </Text>
      ) : null}

      <Button
        mode="contained"
        onPress={handleSendWhatsAppOtp}
        disabled={formDisabled}
        loading={whatsappLoading === "send"}
        style={styles.methodButton}
        contentStyle={styles.methodButtonContent}
      >
        {sendButtonLabel}
      </Button>

      <CountryCodePicker
        visible={showCountryPicker}
        onDismiss={() => setShowCountryPicker(false)}
        onSelect={setSelectedCountry}
        selectedCountry={selectedCountry}
      />
    </View>
  );

  const renderOtpForm = () => (
    <View style={styles.emailScreen} testID="auth-whatsapp-otp">
      <Button
        mode="text"
        icon="arrow-left"
        onPress={() => {
          clearFormError();
          setOtpCode("");
          otpSubmitLockRef.current = false;
          setAuthStep("phone");
        }}
        disabled={formDisabled}
        style={styles.backButton}
        contentStyle={styles.backButtonContent}
      >
        Change number
      </Button>

      <Text variant="headlineSmall" style={[styles.emailTitle, { color: theme.colors.onBackground }]}>
        Enter WhatsApp code
      </Text>
      <Text
        variant="bodyMedium"
        style={[styles.phoneHint, { color: theme.colors.onSurfaceVariant }]}
      >
        Code sent to {displayedPhone}
      </Text>

      <TextInput
        ref={otpInputRef}
        label="6-digit code"
        value={otpCode}
        onChangeText={handleOtpCodeChange}
        mode="outlined"
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        accessibilityLabel="WhatsApp verification code"
        disabled={formDisabled}
        error={Boolean(formError)}
        style={styles.input}
        maxLength={OTP_CODE_LENGTH}
      />

      {formError ? (
        <Text
          accessibilityRole="alert"
          variant="bodyMedium"
          style={[styles.formError, { color: theme.colors.error }]}
        >
          {formError}
        </Text>
      ) : null}

      <Button
        mode="contained"
        onPress={() => void handleVerifyWhatsAppOtp()}
        disabled={formDisabled}
        loading={whatsappLoading === "verify"}
        style={styles.methodButton}
        contentStyle={styles.methodButtonContent}
      >
        {verifyButtonLabel}
      </Button>

      <Button
        mode="text"
        onPress={handleResendWhatsAppOtp}
        disabled={formDisabled || resendSeconds > 0}
        style={styles.resendButton}
        contentStyle={styles.resendButtonContent}
      >
        {resendSeconds > 0 ? formatResendCountdown(resendSeconds) : "Resend code"}
      </Button>
    </View>
  );

  const renderAuthStep = () => {
    switch (authStep) {
      case "methods":
        return renderMethods();
      case "email":
        return renderEmailForm();
      case "phone":
        return renderPhoneForm();
      case "otp":
        return renderOtpForm();
      default: {
        const _exhaustive: never = authStep;
        return _exhaustive;
      }
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            isDesktopWeb && styles.desktopScrollContent,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {isDesktopWeb ? (
            <View style={styles.desktopBrandPane}>
              <View style={styles.desktopBrandTop}>{renderLogo("desktop")}</View>
              <View style={styles.desktopStatement}>
                <Text variant="displaySmall" style={[styles.desktopStatementTitle, { color: theme.colors.onBackground }]}>
                  One shared record for group money.
                </Text>
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                  Shared expenses, clearly settled.
                </Text>
              </View>
              <View style={styles.desktopProof}>
                <View style={[styles.proofLine, { backgroundColor: theme.colors.primary }]} />
                <View style={[styles.proofDot, { backgroundColor: theme.colors.tertiary }]} />
                <View style={[styles.proofDot, { backgroundColor: theme.colors.secondary }]} />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Add · See · Settle
                </Text>
              </View>
            </View>
          ) : null}

          <Surface
            style={[
              styles.authPane,
              isDesktopWeb && styles.desktopAuthPane,
              { backgroundColor: isDesktopWeb ? theme.colors.surface : theme.colors.background },
            ]}
            elevation={0}
          >
            {renderAuthStep()}
          </Surface>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 96,
    paddingBottom: 40,
  },
  desktopScrollContent: {
    flexDirection: "row",
    minHeight: "100%",
    justifyContent: "flex-start",
    padding: 0,
    paddingTop: 0,
  },
  desktopBrandPane: {
    flex: 1.32,
    justifyContent: "space-between",
    paddingHorizontal: 72,
    paddingVertical: 56,
  },
  desktopBrandTop: {
    alignItems: "flex-start",
  },
  desktopLogo: {
    width: 56,
    height: 56,
  },
  desktopStatement: {
    maxWidth: 620,
    gap: 20,
  },
  desktopStatementTitle: {
    fontWeight: "700",
    letterSpacing: -1.6,
    lineHeight: 60,
  },
  desktopProof: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  proofLine: {
    width: 26,
    height: 3,
    borderRadius: 2,
  },
  proofDot: {
    width: 6,
    height: 3,
    borderRadius: 2,
  },
  authPane: {
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-start",
  },
  desktopAuthPane: {
    flex: 0.68,
    justifyContent: "center",
    minWidth: 420,
    paddingHorizontal: 48,
    paddingTop: 56,
  },
  methodScreen: {
    alignItems: "center",
    width: "100%",
    maxWidth: 342,
  },
  logo: {
    width: 50,
    height: 50,
    marginBottom: 28,
  },
  methodTitle: {
    fontWeight: "700",
    textAlign: "center",
  },
  methodStack: {
    gap: 12,
    marginTop: 30,
    width: "100%",
  },
  methodButton: {
    width: "100%",
  },
  methodButtonContent: {
    minHeight: 48,
  },
  appleButtonContainer: {
    height: 48,
  },
  appleButton: {
    height: 48,
    width: "100%",
  },
  disabledSocialButton: {
    opacity: 0.6,
  },
  accountToggle: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
  accountToggleButtonContent: {
    minHeight: 32,
  },
  accountToggleButtonLabel: {
    marginHorizontal: 0,
  },
  emailScreen: {
    width: "100%",
    maxWidth: 342,
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 20,
    marginLeft: -8,
  },
  backButtonContent: {
    minHeight: 40,
  },
  emailTitle: {
    fontWeight: "700",
    marginBottom: 28,
  },
  input: {
    marginBottom: 16,
  },
  formError: {
    fontWeight: "600",
    marginBottom: 16,
  },
  phoneHint: {
    marginBottom: 20,
    marginTop: -12,
  },
  fieldLabel: {
    fontWeight: "600",
    marginBottom: 8,
  },
  phoneRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
    width: "100%",
  },
  countryButton: {
    alignItems: "center",
    borderRadius: PHONE_FIELD_RADIUS,
    borderWidth: 1,
    height: PHONE_FIELD_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  phoneInputShell: {
    borderRadius: PHONE_FIELD_RADIUS,
    borderWidth: 1,
    flex: 1,
    height: PHONE_FIELD_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
  },
  phoneInput: {
    backgroundColor: "transparent",
    fontSize: 16,
    height: PHONE_FIELD_HEIGHT - 2,
    margin: 0,
    paddingHorizontal: 12,
    paddingVertical: 0,
  },
  resendButton: {
    marginTop: 8,
  },
  resendButtonContent: {
    minHeight: 40,
  },
});
