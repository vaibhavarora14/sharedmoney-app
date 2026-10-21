import {
  buildCrashSupportEmailUrl,
  buildSupportEmailUrl,
  SUPPORT_EMAIL,
  SUPPORT_TOPICS,
} from "../mobile/utils/supportEmail.ts";

Deno.test("builds a prefilled email for the selected support topic", () => {
  const url = new URL(
    buildSupportEmailUrl(SUPPORT_TOPICS[1], "vaibhav@example.com"),
  );

  if (url.protocol !== "mailto:") throw new Error("expected a mailto URL");
  if (url.pathname !== SUPPORT_EMAIL) {
    throw new Error("expected the SharedMoney support address");
  }
  if (
    url.searchParams.get("subject") !==
      "SharedMoney support — Groups & balances"
  ) {
    throw new Error("expected a topic-specific subject");
  }
  if (
    url.searchParams.get("body") !==
      "Hi SharedMoney Support,\n\nI need help with: Groups & balances\n\nRegistered email: vaibhav@example.com\n\nDescribe your issue:\n"
  ) {
    throw new Error(
      "expected the selected topic and registered email in the body",
    );
  }
});

Deno.test("uses a useful fallback when the account email is unavailable", () => {
  const url = new URL(buildSupportEmailUrl(SUPPORT_TOPICS[3]));

  if (
    !url.searchParams.get("body")?.includes("Registered email: Not available")
  ) {
    throw new Error("expected the email fallback");
  }
});

Deno.test("builds a prefilled crash-report email with reference, version, and platform", () => {
  const url = new URL(
    buildCrashSupportEmailUrl({
      supportReferenceId: "SM-7K3Q-92",
      appVersion: "2.31.5",
      platform: "ios",
    }),
  );

  if (url.protocol !== "mailto:") throw new Error("expected a mailto URL");
  if (url.pathname !== SUPPORT_EMAIL) {
    throw new Error("expected the SharedMoney support address");
  }
  if (url.searchParams.get("subject") !== "Crash report SM-7K3Q-92") {
    throw new Error("expected the crash subject with the support reference ID");
  }
  const body = url.searchParams.get("body") ?? "";
  if (!body.includes("Support reference: SM-7K3Q-92")) {
    throw new Error("expected the support reference in the body");
  }
  if (!body.includes("App version: 2.31.5")) {
    throw new Error("expected the app version in the body");
  }
  if (!body.includes("Platform: ios")) {
    throw new Error("expected the platform in the body");
  }
  if (body.trim().length === 0) {
    throw new Error("crash compose body must never be blank");
  }
});
