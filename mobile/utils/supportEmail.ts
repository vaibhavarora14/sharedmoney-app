function resolveSupportEmail(): string {
  try {
    if (typeof process !== "undefined" && process?.env?.EXPO_PUBLIC_SUPPORT_EMAIL) {
      return process.env.EXPO_PUBLIC_SUPPORT_EMAIL.trim();
    }
  } catch {
    // Ignore restricted env access (e.g. Deno test runner)
  }
  return "support@sharedmoney.app";
}

export const SUPPORT_EMAIL = resolveSupportEmail();

export const SUPPORT_TOPICS = [
  {
    id: "account-access",
    label: "Account access",
    description: "Sign-in, email, or profile issues",
    icon: "account-key-outline",
  },
  {
    id: "groups-balances",
    label: "Groups & balances",
    description: "Group membership, totals, or settlement questions",
    icon: "account-group-outline",
  },
  {
    id: "transactions",
    label: "Transactions",
    description: "Expenses, edits, or payment records",
    icon: "receipt-text-outline",
  },
  {
    id: "something-else",
    label: "Something else",
    description: "Anything not covered above",
    icon: "message-text-outline",
  },
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export function buildSupportEmailUrl(
  topic: SupportTopic,
  registeredEmail?: string,
) {
  const subject = encodeURIComponent(`SharedMoney support — ${topic.label}`);
  const body = encodeURIComponent(
    `Hi SharedMoney Support,\n\nI need help with: ${topic.label}\n\nRegistered email: ${
      registeredEmail || "Not available"
    }\n\nDescribe your issue:\n`,
  );

  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

export type CrashSupportEmailInput = {
  supportReferenceId: string;
  appVersion: string;
  platform: string;
};

/**
 * Prefill a crash report to the same support inbox the /support page uses.
 * Subject includes the on-screen reference ID; body always carries version + platform.
 */
export function buildCrashSupportEmailUrl(input: CrashSupportEmailInput): string {
  const subject = encodeURIComponent(`Crash report ${input.supportReferenceId}`);
  const body = encodeURIComponent(
    [
      "Hi SharedMoney Support,",
      "",
      "I hit a crash in the app.",
      "",
      `Support reference: ${input.supportReferenceId}`,
      `App version: ${input.appVersion}`,
      `Platform: ${input.platform}`,
      "",
      "What I was doing:",
      "",
    ].join("\n"),
  );

  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
