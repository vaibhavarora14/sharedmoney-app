import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildSettleShareMessage } from "./settleShareMessage.ts";

Deno.test("builds you owe line with formatted amount and group name", () => {
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

Deno.test("builds counterparty owes you line", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [{
        counterpartyName: "Raj",
        direction: "receive",
        amount: 80,
        currency: "USD",
      }],
    }),
    "Raj owes you $80.00.",
  );
});

Deno.test("joins two lines by newline in both directions", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [
        {
          counterpartyName: "Maya Kapoor",
          direction: "pay",
          amount: 500,
          currency: "INR",
          groupName: "Goa trip",
        },
        {
          counterpartyName: "Raj",
          direction: "receive",
          amount: 80,
          currency: "USD",
          groupName: "Dinner",
        },
      ],
    }),
    "You owe Maya Kapoor ₹500.00 in Goa trip.\nRaj owes you $80.00 in Dinner.",
  );
});

Deno.test("appends payment URL after a blank line when provided", () => {
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

Deno.test("omits payment URL for undefined null and whitespace", () => {
  const line = {
    counterpartyName: "Raj",
    direction: "receive" as const,
    amount: 80,
    currency: "USD",
  };

  assertEquals(
    buildSettleShareMessage({ lines: [line] }),
    "Raj owes you $80.00.",
  );
  assertEquals(
    buildSettleShareMessage({ lines: [line], paymentUrl: null }),
    "Raj owes you $80.00.",
  );
  assertEquals(
    buildSettleShareMessage({ lines: [line], paymentUrl: "   " }),
    "Raj owes you $80.00.",
  );
});

Deno.test("uses Someone for blank counterparty", () => {
  assertEquals(
    buildSettleShareMessage({
      lines: [{
        counterpartyName: "   ",
        direction: "receive",
        amount: 500,
        currency: "INR",
      }],
    }),
    "Someone owes you ₹500.00.",
  );
});

Deno.test("omits zero amount lines and returns empty when all are zero", () => {
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
          amount: 80,
          currency: "USD",
        },
      ],
    }),
    "Raj owes you $80.00.",
  );
});
