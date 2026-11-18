import { assertEquals } from "jsr:@std/assert@1";
import type { Group, GroupBalance } from "../types.ts";
import type { PersonSettlement } from "./peopleSettlements.ts";
import {
  buildDirectHomeRows,
  directPeopleForHome,
  groupDebtOffer,
  isFutureLocalDate,
  isGuestAccount,
  quickSettleParties,
  quickSettlePickerPeople,
  quickSettleSharePayload,
  quickSettleSuccessCopy,
  resolveQuickSettleCurrency,
  viewerBalanceDelta,
} from "./quickSettle.ts";

const NOW = new Date("2026-11-18T04:00:00.000Z");

function person(partial: Partial<PersonSettlement> & Pick<PersonSettlement, "key" | "displayName">): PersonSettlement {
  return {
    email: null,
    avatarUrl: null,
    userId: null,
    lines: [],
    netsByCurrency: {},
    ...partial,
  };
}

Deno.test("currency comes from the profile, then one shared currency, and is never invented", () => {
  assertEquals(
    resolveQuickSettleCurrency({ preferredCurrency: "inr", currenciesWithPerson: ["USD"] }),
    { currency: "INR", prefilled: true },
  );
  assertEquals(
    resolveQuickSettleCurrency({ preferredCurrency: null, currenciesWithPerson: ["eur"] }),
    { currency: "EUR", prefilled: true },
  );
  assertEquals(
    resolveQuickSettleCurrency({ preferredCurrency: null, currenciesWithPerson: ["EUR", "USD"] }),
    { currency: null, prefilled: false },
  );
  assertEquals(
    resolveQuickSettleCurrency({ preferredCurrency: " ", currenciesWithPerson: [] }),
    { currency: null, prefilled: false },
  );
});

Deno.test("a debt the other person owes is an expense you paid", () => {
  assertEquals(viewerBalanceDelta("they_owe", 500), 500);
  assertEquals(viewerBalanceDelta("you_owe", 500), -500);
  assertEquals(viewerBalanceDelta("you_paid", 500), 500);
  assertEquals(
    quickSettleParties({
      direction: "they_owe",
      youParticipantId: "you",
      themParticipantId: "them",
    }),
    { payerParticipantId: "you", debtorParticipantId: "them" },
  );
  assertEquals(
    quickSettleParties({
      direction: "you_owe",
      youParticipantId: "you",
      themParticipantId: "them",
    }),
    { payerParticipantId: "them", debtorParticipantId: "you" },
  );
});

Deno.test("overpaying flips the direction in the success copy", () => {
  assertEquals(
    quickSettleSuccessCopy({
      name: "Kabir",
      direction: "you_paid",
      amount: 500,
      currency: "INR",
      previousDirectBalance: 0,
    }).body,
    "Kabir owes you ₹500",
  );
  assertEquals(
    quickSettleSuccessCopy({
      name: "Asha",
      direction: "you_paid",
      amount: 700,
      currency: "INR",
      previousDirectBalance: -500,
    }).body,
    "Now Asha owes you ₹200",
  );
  assertEquals(
    quickSettleSuccessCopy({
      name: "Asha",
      direction: "they_paid",
      amount: 700,
      currency: "INR",
      previousDirectBalance: 500,
    }).body,
    "Now you owe Asha ₹200",
  );
});

Deno.test("v1 share is plain text and has no link", () => {
  const payload = quickSettleSharePayload({
    counterpartyName: "Kabir Shah",
    theyOweYou: true,
    amount: 500,
    currency: "INR",
    note: "Movie tickets",
  });
  assertEquals(payload.kind, "text");
  if (payload.kind === "text") {
    assertEquals(payload.message.includes("http"), false);
    assertEquals(payload.message.includes("Kabir, you owe ₹500."), true);
    assertEquals(payload.message.includes("Movie tickets"), true);
  }
});

Deno.test("the person picker leads with open balances and hides settled people until search", () => {
  const dev = person({
    key: "dev",
    displayName: "Dev",
    netsByCurrency: { INR: 2860 },
    lines: [],
  });
  const rahul = person({
    key: "rahul",
    displayName: "Rahul",
    netsByCurrency: { INR: 1250 },
  });
  const even = person({
    key: "even",
    displayName: "Neel",
    netsByCurrency: { INR: 0 },
  });
  assertEquals(quickSettlePickerPeople([rahul, even, dev], "").map((item) => item.displayName), ["Dev", "Rahul"]);
  assertEquals(quickSettlePickerPeople([rahul, even, dev], "nee").map((item) => item.displayName), ["Neel"]);
});

Deno.test("open group debts are offered before a direct payment and are not summed across currencies", () => {
  const rahul = person({
    key: "rahul",
    displayName: "Rahul",
    lines: [
      {
        groupId: "goa",
        groupName: "Goa trip",
        kind: "standard",
        amount: 1600,
        currency: "INR",
        direction: "receive",
        signedAmount: 1600,
        you: { user_id: "me", amount: 1600, currency: "INR" },
        other: { user_id: "rahul", amount: -1600, currency: "INR" },
        originalParts: [],
      },
      {
        groupId: "flat",
        groupName: "Flat 4B",
        kind: "standard",
        amount: 350,
        currency: "INR",
        direction: "pay",
        signedAmount: -350,
        you: { user_id: "me", amount: -350, currency: "INR" },
        other: { user_id: "rahul", amount: 350, currency: "INR" },
        originalParts: [],
      },
      {
        groupId: "direct",
        groupName: "Rahul",
        kind: "direct",
        amount: 500,
        currency: "INR",
        direction: "receive",
        signedAmount: 500,
        you: { user_id: "me", amount: 500, currency: "INR" },
        other: { user_id: "rahul", amount: -500, currency: "INR" },
        originalParts: [],
      },
    ],
  });
  const offer = groupDebtOffer(rahul);
  assertEquals(offer?.headline, "Rahul owes you ₹1,250 across 2 groups");
  assertEquals(offer?.lines.length, 2);
  assertEquals(offer?.net, 1250);
});

Deno.test("direct people are one row each up to three, then one grouped row", () => {
  const balances = (id: string, amount: number): GroupBalance => ({
    group_id: id,
    group_name: id,
    group_kind: "direct",
    balances: [{ user_id: "me", amount, currency: "INR" }],
  });
  const group = (id: string, name: string): Group => ({
    id,
    name,
    kind: "direct",
    created_by: "me",
    created_at: "2026-11-18T00:00:00.000Z",
    updated_at: "2026-11-18T00:00:00.000Z",
    user_status: "active",
    last_activity: {
      actor: "You",
      action: "settled",
      subject: name,
      detail: "Movie tickets",
      at: "2026-11-18T03:59:30.000Z",
      viewerPaid: true,
    },
  });
  const one = buildDirectHomeRows({
    groups: [group("k", "Kabir"), { ...group("gone", "Gone"), user_status: "active", kind: "standard" }],
    groupBalances: [balances("k", 500)],
    userId: "me",
    now: NOW,
  });
  assertEquals(one.map((row) => row.title), ["Direct · Kabir"]);
  assertEquals(one[0]?.subtitle, "Movie tickets · now");
  assertEquals(directPeopleForHome(one), { count: 1, name: "Kabir" });

  const four = buildDirectHomeRows({
    groups: [group("a", "A"), group("b", "B"), group("c", "C"), group("d", "D")],
    groupBalances: [balances("a", 10), balances("b", 20), balances("c", 30), balances("d", 40)],
    userId: "me",
    now: NOW,
  });
  assertEquals(four.length, 1);
  assertEquals(four[0]?.title, "Direct · 4 people");
  assertEquals(four[0]?.amount, 100);
  assertEquals(directPeopleForHome(four), { count: 4 });
});

Deno.test("a future date is rejected and guests are detected without guest-mode code", () => {
  assertEquals(isFutureLocalDate("2026-11-19", new Date("2026-11-18T15:00:00")), true);
  assertEquals(isFutureLocalDate("2026-11-18", new Date("2026-11-18T15:00:00")), false);
  assertEquals(isGuestAccount(null), false);
  assertEquals(isGuestAccount({ is_anonymous: true }), true);
  assertEquals(isGuestAccount({ app_metadata: { guest: true } }), true);
  assertEquals(isGuestAccount({ app_metadata: { provider: "email" } }), false);
});
