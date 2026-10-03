import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildSettleHandoffPack,
  resolveSettleHandoffCountry,
} from "./settleHandoff.ts";
import { buildSettleShareMessage } from "./settleShareMessage.ts";

const payLine = {
  counterpartyName: "Maya Kapoor",
  direction: "pay" as const,
  amount: 500,
  currency: "INR",
  groupName: "Goa trip",
};

Deno.test("country choice follows override, profile, locale, default, and unmapped generic", () => {
  assertEquals(
    resolveSettleHandoffCountry({ profileCountryCode: "IN", localeCountryCode: "US" }).pack,
    "IN",
  );
  assertEquals(
    resolveSettleHandoffCountry({
      overrideCountryCode: "BR",
      profileCountryCode: "IN",
      localeCountryCode: "US",
    }).pack,
    "BR",
  );
  assertEquals(resolveSettleHandoffCountry({}).pack, "US");
  assertEquals(resolveSettleHandoffCountry({ profileCountryCode: "GB" }).pack, "GENERIC");
});

Deno.test("US venmo handle builds a safe https link and whitespace handle is ignored", () => {
  const pack = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "USD", amount: 42.5 }],
    counterpartyName: "Maya Kapoor",
    details: { venmoHandle: "@maya" },
    country: { profileCountryCode: "US" },
  });

  assertEquals(
    pack.shareUrl,
    "https://venmo.com/u/maya?txn=pay&amount=42.50&note=SharedMoney%20Goa%20trip",
  );
  assertEquals(pack.actions[0]?.label, "Open Venmo");

  const noHandle = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "USD" }],
    counterpartyName: "Maya Kapoor",
    details: { venmoHandle: "   " },
    country: { profileCountryCode: "US" },
  });

  assertEquals(noHandle.shareUrl, null);
  assertEquals(noHandle.actions.some((action) => action.label === "Open Venmo"), false);
});

Deno.test("US pasted javascript and arbitrary https URLs are rejected", () => {
  const javascriptPack = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "USD" }],
    counterpartyName: "Maya Kapoor",
    details: { venmoHandle: "javascript:alert(1)" },
    country: { profileCountryCode: "US" },
  });
  const evilPack = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "USD" }],
    counterpartyName: "Maya Kapoor",
    details: { cashAppCashtag: "https://evil.example/$maya" },
    country: { profileCountryCode: "US" },
  });

  assertEquals(javascriptPack.shareUrl, null);
  assertEquals(evilPack.shareUrl, null);
  assertEquals(javascriptPack.actions.some((action) => action.kind === "open"), false);
  assertEquals(evilPack.actions.some((action) => action.kind === "open"), false);
});

Deno.test("India VPA builds UPI intent and missing VPA falls back to generic copy", () => {
  const pack = buildSettleHandoffPack({
    lines: [payLine],
    counterpartyName: "Maya Kapoor",
    details: { upiVpa: "maya@okicici" },
    country: { profileCountryCode: "IN" },
  });

  assert(pack.shareUrl?.startsWith("upi://pay?"));
  assertMatch(pack.shareUrl ?? "", /pa=maya%40okicici/);
  assertMatch(pack.shareUrl ?? "", /am=500\.00/);
  assertMatch(pack.shareUrl ?? "", /cu=INR/);
  assertMatch(pack.shareUrl ?? "", /tn=SharedMoney%20Goa%20trip/);

  const missing = buildSettleHandoffPack({
    lines: [payLine],
    counterpartyName: "Maya Kapoor",
    details: {},
    country: { profileCountryCode: "IN" },
  });

  assertEquals(missing.shareUrl, null);
  assert(missing.copyText.includes("₹500.00"));
});

Deno.test("EU IBAN copy includes IBAN and reference and has no share URL", () => {
  const pack = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "EUR", amount: 12 }],
    counterpartyName: "Maya Kapoor",
    details: { iban: "DE89370400440532013000", ibanName: "Maya Kapoor" },
    country: { profileCountryCode: "DE" },
  });

  assertEquals(pack.shareUrl, null);
  assert(pack.copyText.includes("DE89370400440532013000"));
  assert(pack.copyText.includes("Maya Kapoor"));
  assert(pack.copyText.includes("SharedMoney Goa trip"));
});

Deno.test("Brazil Pix copy contains key, has no share URL, and exposes no QR action", () => {
  const pack = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "BRL", amount: 30 }],
    counterpartyName: "Maya Kapoor",
    details: { pixKey: "maya@example.com" },
    country: { profileCountryCode: "BR" },
  });

  assertEquals(pack.shareUrl, null);
  assert(pack.copyText.includes("maya@example.com"));
  assertEquals(pack.actions.some((action) => /qr/i.test(action.label)), false);
});

Deno.test("builders are pure and deterministic", () => {
  const input = {
    lines: [{ ...payLine, currency: "USD" }],
    counterpartyName: "Maya Kapoor",
    details: { paypalMe: "maya-pay" },
    country: { profileCountryCode: "US" },
  };

  assertEquals(buildSettleHandoffPack(input), buildSettleHandoffPack(input));
});

Deno.test("settle share message appends only a real handoff link", () => {
  const withLink = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "USD", amount: 20 }],
    counterpartyName: "Maya Kapoor",
    details: { cashAppCashtag: "$maya" },
    country: { profileCountryCode: "US" },
  });
  const noLink = buildSettleHandoffPack({
    lines: [{ ...payLine, currency: "EUR", amount: 20 }],
    counterpartyName: "Maya Kapoor",
    details: { iban: "DE89370400440532013000", ibanName: "Maya Kapoor" },
    country: { profileCountryCode: "DE" },
  });

  assertEquals(
    buildSettleShareMessage({ lines: [payLine], paymentUrl: withLink.shareUrl }),
    `You owe Maya Kapoor ₹500.00 in Goa trip.\n\n${withLink.shareUrl}`,
  );
  assertEquals(
    buildSettleShareMessage({ lines: [payLine], paymentUrl: noLink.shareUrl }),
    "You owe Maya Kapoor ₹500.00 in Goa trip.",
  );
});
