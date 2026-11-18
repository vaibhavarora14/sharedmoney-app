import * as AppleAuthentication from "expo-apple-authentication";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Button, TextInput, useTheme } from "react-native-paper";
import { useAuth } from "../../contexts/AuthContext";
import { isGuestUser, guestSignInCopy } from "../../utils/guestMode";
import { setGuestGateListener, type GuestSignInRequest } from "../../utils/guestGate";
import {
  clearStashedGuestUpgrade,
  discardStashedGuest,
  linkGuestEmail,
  linkGuestProvider,
  mergeStashedGuest,
  mintAndStashGuestUpgrade,
  previewGuestMerge,
  readStashedGuestUpgrade,
  restoreStashedGuestSession,
  type GuestMergePreview,
  type StashedGuestUpgrade,
} from "../../utils/guestUpgrade";
import { canUseNativeGoogleSignIn, signInWithNativeGoogle } from "../../utils/nativeGoogleAuth";
import { getConfiguredWebAppPath } from "../../utils/inviteLinks";
import { isWhatsAppOtpLoginEnabled } from "../../utils/whatsappOtpLogin";
import { aliasAnalyticsUser, captureAnalyticsEvent } from "../../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../../utils/posthogEvents";
import { sendWhatsAppOtp } from "../../utils/whatsappOtpApi";
import { supabase } from "../../supabase";
import { GuestMergeSheet, GuestSignInSheet, GuestSnackbar } from "./GuestChrome";

type SheetStep = "methods" | "email" | "whatsapp";

function promptTrigger(action: string): "chip" | "gated_action" | "data_warning" | "cleanup_banner" {
  if (action === "chip") return "chip";
  if (action === "cleanup_banner") return "cleanup_banner";
  if (action === "profile" || action === "device_warning") return "data_warning";
  return "gated_action";
}

export function GuestSessionHost() {
  const theme = useTheme();
  const { user, signInWithGoogle, signInWithApple, signInWithWhatsAppOtp, signIn } = useAuth();
  const [request, setRequest] = useState<GuestSignInRequest | null>(null);
  const [step, setStep] = useState<SheetStep>("methods");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState<GuestMergePreview | null>(null);
  const [stash, setStash] = useState<StashedGuestUpgrade | null>(null);
  const [mergeFailed, setMergeFailed] = useState(false);
  const [kept, setKept] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    setGuestGateListener((next) => {
      setStep("methods");
      setRequest(next);
      captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_SIGNIN_PROMPT_SHOWN, {
        trigger: promptTrigger(next.action),
        action: next.action,
      });
    });
    return () => setGuestGateListener(null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await readStashedGuestUpgrade();
      if (cancelled || !saved || !user || user.is_anonymous) return;
      if (user.id === saved.guestUserId) {
        await clearStashedGuestUpgrade();
        captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_CONVERTED, { method: "link", path: "link" });
        captureAnalyticsEvent(ANALYTICS_EVENTS.AUTH_SUCCEEDED, {
          auth_provider: "link",
          platform: Platform.OS,
          is_new_user: true,
          from_guest: true,
        });
        setKept(true);
        return;
      }
      try {
        const preview = await previewGuestMerge(saved);
        if (cancelled) return;
        setStash(saved);
        setMerge(preview);
        setMergeFailed(false);
      } catch {
        if (!cancelled) {
          setStash(saved);
          setMerge({ groups: [], group_count: saved.groupCount, expense_count: saved.expenseCount, payment_count: 0 });
          setMergeFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.is_anonymous]);

  const closeSheet = () => {
    setRequest(null);
    setStep("methods");
  };

  const prepare = async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.user.is_anonymous) return null;
    return mintAndStashGuestUpgrade(session);
  };

  const finishLinked = async () => {
    await clearStashedGuestUpgrade();
    closeSheet();
    setKept(true);
    captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_CONVERTED, { method: "link", path: "link" });
  };

  const onGoogle = async () => {
    setBusy(true);
    captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_SIGNIN_STARTED, { method: "google" });
    try {
      if (isGuestUser(user)) await prepare();
      if (isGuestUser(user) && canUseNativeGoogleSignIn()) {
        const native = await signInWithNativeGoogle();
        if (native.status !== "success") return;
        const path = await linkGuestProvider({
          provider: "google",
          token: native.idToken,
          nonce: native.rawNonce,
        });
        if (path === "link") {
          await finishLinked();
          return;
        }
        if (path === "merge") {
          await supabase.auth.signInWithIdToken({
            provider: "google",
            token: native.idToken,
            nonce: native.rawNonce,
          });
          closeSheet();
          return;
        }
        return;
      }
      if (isGuestUser(user)) {
        const redirectTo = Platform.OS === "web" && typeof window !== "undefined"
          ? `${window.location.origin}${getConfiguredWebAppPath() || ""}`
          : undefined;
        const path = await linkGuestProvider({ provider: "google", redirectTo });
        if (path === "link") {
          await finishLinked();
          return;
        }
        if (path !== "merge") return;
      }
      closeSheet();
      await signInWithGoogle();
    } finally {
      setBusy(false);
    }
  };

  const onApple = async () => {
    setBusy(true);
    captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_SIGNIN_STARTED, { method: "apple" });
    try {
      if (isGuestUser(user)) await prepare();
      if (isGuestUser(user) && Platform.OS === "ios") {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });
        if (!credential.identityToken) return;
        const path = await linkGuestProvider({
          provider: "apple",
          token: credential.identityToken,
        });
        if (path === "link") {
          await finishLinked();
          return;
        }
        if (path === "merge") {
          await supabase.auth.signInWithIdToken({
            provider: "apple",
            token: credential.identityToken,
          });
          closeSheet();
          return;
        }
        return;
      }
      closeSheet();
      await signInWithApple();
    } catch {
      // User cancelled Apple, or the provider failed. The guest session stays.
    } finally {
      setBusy(false);
    }
  };

  const onEmail = async () => {
    if (step !== "email") {
      setStep("email");
      return;
    }
    setBusy(true);
    captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_SIGNIN_STARTED, { method: "email" });
    try {
      if (isGuestUser(user)) {
        await prepare();
        const path = await linkGuestEmail(email.trim(), password);
        if (path === "link") {
          await finishLinked();
          return;
        }
        if (path === "merge") {
          const result = await signIn(email.trim(), password);
          if (!result.error) closeSheet();
          return;
        }
        return;
      }
      const result = await signIn(email.trim(), password);
      if (!result.error) closeSheet();
    } finally {
      setBusy(false);
    }
  };

  const onWhatsApp = async () => {
    if (step !== "whatsapp") {
      setStep("whatsapp");
      return;
    }
    setBusy(true);
    if (!code.trim()) {
      try {
        await sendWhatsAppOtp(phone.trim());
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_SIGNIN_STARTED, { method: "whatsapp" });
    try {
      if (isGuestUser(user)) await prepare();
      const result = await signInWithWhatsAppOtp(phone.trim(), code.trim());
      if (!result.error) closeSheet();
    } finally {
      setBusy(false);
    }
  };

  const onBringIn = async () => {
    if (!stash) return;
    setBusy(true);
    try {
      await mergeStashedGuest(stash);
      aliasAnalyticsUser(stash.guestUserId);
      captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_CONVERTED, { method: "merge", path: "merge" });
      await clearStashedGuestUpgrade();
      setMerge(null);
      setStash(null);
      setKept(true);
    } catch {
      setMergeFailed(true);
      captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_MERGE_FAILED, { reason_code: "merge_failed" });
      try {
        await restoreStashedGuestSession(stash);
      } catch {
        // The guest refresh token is still in storage for another try.
      }
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async () => {
    if (!stash) return;
    setBusy(true);
    try {
      await discardStashedGuest(stash);
      await clearStashedGuestUpgrade();
      setMerge(null);
      setStash(null);
    } finally {
      setBusy(false);
    }
  };

  const sheetBody = request?.action === "chip" && request.body
    ? request.body
    : request?.body;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <GuestSignInSheet
        visible={request !== null}
        title={request?.title ?? "Keep your data"}
        body={sheetBody ?? guestSignInCopy("chip").body}
        onClose={closeSheet}
        methods={{
          appleAvailable,
          whatsAppAvailable: isWhatsAppOtpLoginEnabled(),
          busy,
          onGoogle: () => { void onGoogle(); },
          onApple: () => { void onApple(); },
          onEmail: () => { void onEmail(); },
          onWhatsApp: () => { void onWhatsApp(); },
        }}
      />
      {request && step === "email" ? (
        <View style={[styles.emailFields, { backgroundColor: theme.colors.surface }]} pointerEvents="box-none">
          <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" mode="outlined" />
          <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />
          <Button mode="contained" onPress={() => { void onEmail(); }} loading={busy}>Continue</Button>
        </View>
      ) : null}
      {request && step === "whatsapp" ? (
        <View style={[styles.emailFields, { backgroundColor: theme.colors.surface }]}>
          <TextInput label="Phone" value={phone} onChangeText={setPhone} mode="outlined" />
          <TextInput label="Code" value={code} onChangeText={setCode} mode="outlined" />
          <Button mode="contained" onPress={() => { void onWhatsApp(); }} loading={busy}>Verify and continue</Button>
        </View>
      ) : null}
      <GuestMergeSheet
        visible={merge !== null}
        groups={(merge?.groups ?? []).map((group) => ({ name: group.name, note: group.note }))}
        busy={busy}
        failed={mergeFailed}
        onBringIn={() => { void onBringIn(); }}
        onDiscard={() => { void onDiscard(); }}
        onRetry={() => { void onBringIn(); }}
      />
      {kept ? (
        <View style={styles.kept}>
          <GuestSnackbar message="Signed in. Everything is kept." />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emailFields: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 280,
    gap: 8,
  },
  kept: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 88,
  },
});
