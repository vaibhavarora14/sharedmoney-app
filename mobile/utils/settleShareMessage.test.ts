import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildSettleRemindMessage,
  buildSettleShareMessage,
  buildSettleSummaryMessage,
  buildWhatsAppMeUrl,
  buildWhatsAppSendUrl,
  formatShareAmountInput,
  formatShareCurrency,
  formatSettleSummaryEdgeLine,
  parseShareAmountInput,
  settleFirstName,
  settleSharePersonName,
  whatsAppPhoneDigits,
} from "./settleShareMessage.ts";

Deno.test("settleFirstName uses first token and falls back", () => {
  assertEquals(settleFirstName("Maya Kapoor"), "Maya");
  assertEquals(settleFirstName("  Raj  "), "Raj");
  assertEquals(settleFirstName("   "), "there");
  assertEquals(settleFirstName(null), "there");
});

Deno.test("settleSharePersonName never returns You and prefers first name", () => {
  assertEquals(
    settleSharePersonName({ full_name: "Vaibhav Arora", email: "v@x.com" }),
    "Vaibhav",
  );
  assertEquals(
    settleSharePersonName({ full_name: "You", email: "alice@test.com" }),
    "alice",
  );
  assertEquals(
    settleSharePersonName({ full_name: null, email: "charlie@test.com" }),
    "charlie",
  );
  assertEquals(settleSharePersonName({}), "Someone");
});

Deno.test("formatShareCurrency drops .00 for whole amounts and keeps paise", () => {
  assertEquals(formatShareCurrency(30000, "INR"), "₹30,000");
  assertEquals(formatShareCurrency(5625, "INR"), "₹5,625");
  assertEquals(formatShareCurrency(431.2, "INR"), "₹431.20");
  assertEquals(formatShareCurrency(80, "USD"), "$80");
  assertEquals(formatShareCurrency(80.5, "USD"), "$80.50");
});

Deno.test("formatShareAmountInput matches share grouping without currency symbol", () => {
  assertEquals(formatShareAmountInput(30000, "INR"), "30,000");
  assertEquals(formatShareAmountInput(5625, "INR"), "5,625");
  assertEquals(formatShareAmountInput(431.2, "INR"), "431.20");
  assertEquals(formatShareAmountInput(80, "USD"), "80");
  assertEquals(formatShareAmountInput(80.5, "USD"), "80.50");
});

Deno.test("parseShareAmountInput accepts grouped prefills and rejects junk", () => {
  assertEquals(parseShareAmountInput("30,000"), 30000);
  assertEquals(parseShareAmountInput("5,625.50"), 5625.5);
  assertEquals(parseShareAmountInput("80"), 80);
  assertEquals(parseShareAmountInput("80.50"), 80.5);
  assertEquals(parseShareAmountInput(""), null);
  assertEquals(parseShareAmountInput("30,000.123"), null);
  assertEquals(parseShareAmountInput("abc"), null);
});

Deno.test("buildSettleRemindMessage marks settled in the group with trimmed amount", () => {
  assertEquals(
    buildSettleRemindMessage({
      counterpartyName: "Maya Kapoor",
      amount: 431.2,
      currency: "INR",
      groupName: "Apartment 4B",
      settleLink: "https://sharedmoney.app/app/groups/abc",
    }),
    "Hi Maya, quick one from Apartment 4B: you owe me ₹431.20. No rush. Once you've paid, mark it settled in the group:\n\nhttps://sharedmoney.app/app/groups/abc",
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
    "Hi Raj, quick one from Dinner: you owe me $80. No rush. Once you've paid, mark it settled in the group:",
  );
});

Deno.test("formatSettleSummaryEdgeLine uses real names never You", () => {
  assertEquals(
    formatSettleSummaryEdgeLine({
      fromName: "Vaibhav",
      toName: "alice",
      amount: 5625,
      currency: "INR",
    }),
    "Vaibhav pays alice ₹5,625",
  );
  assertEquals(
    formatSettleSummaryEdgeLine({
      fromName: "diana",
      toName: "alice",
      amount: 30000,
      currency: "INR",
    }),
    "diana pays alice ₹30,000",
  );
});

Deno.test("buildSettleSummaryMessage lists pays lines then group link", () => {
  assertEquals(
    buildSettleSummaryMessage({
      groupName: "Summer Vacation 2024",
      edges: [
        { fromName: "diana", toName: "alice", amount: 30000, currency: "INR" },
        { fromName: "Vaibhav", toName: "alice", amount: 5625, currency: "INR" },
        { fromName: "Vaibhav", toName: "bob", amount: 5625, currency: "INR" },
      ],
      groupLink: "https://sharedmoney.app/app/groups/g1",
    }),
    "Summer Vacation 2024, settle-up:\ndiana pays alice ₹30,000\nVaibhav pays alice ₹5,625\nVaibhav pays bob ₹5,625\n\nhttps://sharedmoney.app/app/groups/g1",
  );
});

Deno.test("buildSettleSummaryMessage for seed Summer Vacation nets", () => {
  assertEquals(
    buildSettleSummaryMessage({
      groupName: "Summer Vacation 2024",
      edges: [
        { fromName: "Diana", toName: "Alice", amount: 39375, currency: "INR" },
        { fromName: "Bob", toName: "Alice", amount: 19375, currency: "INR" },
        { fromName: "Charlie", toName: "Alice", amount: 1875, currency: "INR" },
      ],
      groupLink:
        "https://sharedmoney.app/app/groups/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    }),
    "Summer Vacation 2024, settle-up:\nDiana pays Alice ₹39,375\nBob pays Alice ₹19,375\nCharlie pays Alice ₹1,875\n\nhttps://sharedmoney.app/app/groups/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  );
});

Deno.test("buildSettleSummaryMessage returns empty when all edges are zero", () => {
  assertEquals(
    buildSettleSummaryMessage({
      groupName: "Goa trip",
      edges: [
        { fromName: "Maya", toName: "Alice", amount: 0, currency: "INR" },
        { fromName: "Raj", toName: "Bob", amount: 0.004, currency: "USD" },
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
    "Hi Maya, quick one from Goa trip: you owe me ₹500. No rush. Once you've paid, mark it settled in the group:\n\nhttps://sharedmoney.app/app/groups/g1",
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
    "You owe Maya Kapoor ₹500 in Goa trip.",
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
    "You owe Maya Kapoor ₹500.\n\nhttps://example.com/settle",
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
