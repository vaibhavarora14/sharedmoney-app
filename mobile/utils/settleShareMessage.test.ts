import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildSettleRemindMessage,
  buildSettleShareMessage,
  buildSettleSummaryMessage,
  buildWhatsAppMeUrl,
  buildWhatsAppSendUrl,
  formatSettleSummaryEdgeLine,
  settleFirstName,
  whatsAppPhoneDigits,
} from "./settleShareMessage.ts";

Deno.test("settleFirstName uses first token and falls back", () => {
  assertEquals(settleFirstName("Maya Kapoor"), "Maya");
  assertEquals(settleFirstName("  Raj  "), "Raj");
  assertEquals(settleFirstName("   "), "there");
  assertEquals(settleFirstName(null), "there");
});

Deno.test("buildSettleRemindMessage is second-person with link on its own line", () => {
  assertEquals(
    buildSettleRemindMessage({
      counterpartyName: "Maya Kapoor",
      amount: 431.2,
      currency: "INR",
      groupName: "Apartment 4B",
      settleLink: "https://sharedmoney.app/app/groups/abc",
    }),
    "Hi Maya, quick one from Apartment 4B: you owe me ₹431.20. No rush. Once you've paid, tap to mark it settled:\nhttps://sharedmoney.app/app/groups/abc",
  );
});

Deno.test("buildSettleRemindMessage omits blank link line", () => {
  assertEquals(
    buildSettleRemindMessage({
      counterpartyName: "Raj",
      amount: 80,
      currency: "USD",
      groupName: "Dinner",
      settleLink: "  ",
    }),
    "Hi Raj, quick one from Dinner: you owe me $80.00. No rush. Once you've paid, tap to mark it settled:",
  );
});

Deno.test("formatSettleSummaryEdgeLine uses You pay when viewer is payer", () => {
  assertEquals(
    formatSettleSummaryEdgeLine({
      fromName: "You",
      toName: "alice",
      amount: 5625,
      currency: "INR",
    }),
    "You pay alice ₹5,625.00",
  );
});

Deno.test("formatSettleSummaryEdgeLine uses pays you when viewer is payee", () => {
  assertEquals(
    formatSettleSummaryEdgeLine({
      fromName: "Maya",
      toName: "You",
      amount: 500,
      currency: "INR",
    }),
    "Maya pays you ₹500.00",
  );
});

Deno.test("buildSettleSummaryMessage lists pays lines then group link", () => {
  assertEquals(
    buildSettleSummaryMessage({
      groupName: "Goa trip",
      edges: [
        { fromName: "Maya", toName: "You", amount: 500, currency: "INR" },
        { fromName: "You", toName: "Raj", amount: 80, currency: "USD" },
      ],
      groupLink: "https://sharedmoney.app/app/groups/g1",
    }),
    "Goa trip, settle-up:\nMaya pays you ₹500.00\nYou pay Raj $80.00\nhttps://sharedmoney.app/app/groups/g1",
  );
});

Deno.test("buildSettleSummaryMessage returns empty when all edges are zero", () => {
  assertEquals(
    buildSettleSummaryMessage({
      groupName: "Goa trip",
      edges: [
        { fromName: "Maya", toName: "You", amount: 0, currency: "INR" },
        { fromName: "You", toName: "Raj", amount: 0.004, currency: "USD" },
      ],
      groupLink: "https://sharedmoney.app/app/groups/g1",
    }),
    "",
  );
});

Deno.test("whatsAppPhoneDigits normalizes E.164 and strips punctuation", () => {
  assertEquals(whatsAppPhoneDigits("+91 98765-43210"), "919876543210");
  assertEquals(whatsAppPhoneDigits("+14155552671"), "14155552671");
  assertEquals(whatsAppPhoneDigits("919876543210"), "919876543210");
});

Deno.test("whatsAppPhoneDigits rejects empty invalid and leading-zero national", () => {
  assertEquals(whatsAppPhoneDigits(null), null);
  assertEquals(whatsAppPhoneDigits("   "), null);
  assertEquals(whatsAppPhoneDigits("123"), null);
  assertEquals(whatsAppPhoneDigits("09876543210"), null);
});

Deno.test("buildWhatsAppMeUrl and send URL encode text and digits", () => {
  const text = "Hi Maya, quick one from Goa:\nyou owe me ₹500.";
  assertEquals(
    buildWhatsAppMeUrl("+91 98765-43210", text),
    `https://wa.me/919876543210?text=${encodeURIComponent(text)}`,
  );
  assertEquals(
    buildWhatsAppSendUrl("919876543210", text),
    `whatsapp://send?phone=919876543210&text=${encodeURIComponent(text)}`,
  );
});

Deno.test("legacy buildSettleShareMessage maps single receive to remind copy", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [{
        counterpartyName: "Maya Kapoor",
        direction: "receive",
        amount: 500,
        currency: "INR",
        groupName: "Goa trip",
      }],
      settleLink: "https://sharedmoney.app/app/groups/g1",
    }),
    "Hi Maya, quick one from Goa trip: you owe me ₹500.00. No rush. Once you've paid, tap to mark it settled:\nhttps://sharedmoney.app/app/groups/g1",
  );
});

Deno.test("legacy buildSettleShareMessage still joins pay lines", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [{
        counterpartyName: "Maya Kapoor",
        direction: "pay",
        amount: 500,
        currency: "INR",
        groupName: "Goa trip",
      }],
    }),
    "You owe Maya Kapoor ₹500.00 in Goa trip.",
  );
});

Deno.test("legacy buildSettleShareMessage appends payment URL after blank line", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [{
        counterpartyName: "Maya Kapoor",
        direction: "pay",
        amount: 500,
        currency: "INR",
      }],
      paymentUrl: "  https://example.com/settle  ",
    }),
    "You owe Maya Kapoor ₹500.00.\n\nhttps://example.com/settle",
  );
});

Deno.test("legacy omits zero amount lines and returns empty when all are zero", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [
        {
          counterpartyName: "Maya Kapoor",
          direction: "pay",
          amount: 0,
          currency: "INR",
        },
        {
          counterpartyName: "Raj",
          direction: "receive",
          amount: 0.004,
          currency: "USD",
        },
      ],
    }),
    "",
  );
});
