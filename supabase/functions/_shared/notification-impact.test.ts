import {
  buildNotificationImpacts,
  type ExpenseSnapshot,
} from "./notification-impact.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message ?? "values differ"}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`,
    );
  }
}

const base: ExpenseSnapshot = {
  id: 42,
  groupId: "group-1",
  groupName: "Goa Trip",
  description: "Dinner",
  type: "expense",
  amount: 1200,
  currency: "INR",
  payerParticipantId: "p-alex",
  participants: [
    { participantId: "p-alex", userId: "u-alex", share: 600 },
    { participantId: "p-priya", userId: "u-priya", share: 600 },
  ],
};

Deno.test("creation notifies linked financial participants except the actor", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-alex",
    action: "created",
    before: null,
    after: base,
  });

  assertEquals(result.map((item) => item.userId), ["u-priya"]);
  assertEquals(result[0].after?.shareMinor, 60000);
  assertEquals(result[0].after?.netMinor, -60000);
});

Deno.test("creation does not notify when recipient net position does not change", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "created",
    before: null,
    after: {
      ...base,
      participants: [
        { participantId: "p-alex", userId: "u-alex", share: 1200 },
        { participantId: "p-priya", userId: "u-priya", share: 0 },
      ],
      payerParticipantId: "p-alex",
    },
  });

  assertEquals(result, []);
});

Deno.test("unlinked participants never become recipients", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-alex",
    action: "created",
    before: null,
    after: {
      ...base,
      participants: [
        ...base.participants,
        { participantId: "p-guest", userId: null, share: 0 },
      ],
    },
  });

  assertEquals(result.map((item) => item.userId), ["u-priya"]);
});

Deno.test("cosmetic edits do not notify", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "updated",
    before: base,
    after: { ...base, description: "Dinner at Thalassa" },
  });

  assertEquals(result, []);
});

Deno.test("amount edits notify every affected linked participant", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "updated",
    before: base,
    after: {
      ...base,
      amount: 1500,
      participants: [
        { participantId: "p-alex", userId: "u-alex", share: 750 },
        { participantId: "p-priya", userId: "u-priya", share: 750 },
      ],
    },
  });

  assertEquals(result.map((item) => item.userId), ["u-alex", "u-priya"]);
  assertEquals(result[1].before?.shareMinor, 60000);
  assertEquals(result[1].after?.shareMinor, 75000);
});

Deno.test("payer changes notify split participants even when their share is unchanged", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "updated",
    before: base,
    after: { ...base, payerParticipantId: "p-priya" },
  });

  assertEquals(result.map((item) => item.userId), ["u-alex", "u-priya"]);
});

Deno.test("multi-payer expenses credit each person's paid amount", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "created",
    before: null,
    after: {
      ...base,
      payers: [
        { participantId: "p-alex", amount: 700 },
        { participantId: "p-priya", amount: 500 },
      ],
      participants: [
        { participantId: "p-alex", userId: "u-alex", share: 600 },
        { participantId: "p-priya", userId: "u-priya", share: 600 },
      ],
    },
  });

  const byUser = Object.fromEntries(result.map((item) => [item.userId, item.after]));
  assertEquals(byUser["u-alex"]?.paidMinor, 70000);
  assertEquals(byUser["u-alex"]?.netMinor, 10000);
  assertEquals(byUser["u-priya"]?.paidMinor, 50000);
  assertEquals(byUser["u-priya"]?.netMinor, -10000);
});

Deno.test("a linked payer with no share is still a financial participant", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "created",
    before: null,
    after: {
      ...base,
      participants: [
        { participantId: "p-alex", userId: "u-alex", share: 0 },
        { participantId: "p-priya", userId: "u-priya", share: 1200 },
      ],
    },
  });

  assertEquals(result.map((item) => item.userId), ["u-alex", "u-priya"]);
  assertEquals(result[0].after?.paidMinor, 120000);
});

Deno.test("split membership uses the before and after recipient union", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "updated",
    before: base,
    after: {
      ...base,
      participants: [
        { participantId: "p-alex", userId: "u-alex", share: 400 },
        { participantId: "p-new", userId: "u-new", share: 800 },
      ],
    },
  });

  assertEquals(result.map((item) => item.userId), ["u-alex", "u-new", "u-priya"]);
  assertEquals(result[2].after, null);
});

Deno.test("currency changes notify participants even with unchanged numeric shares", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "updated",
    before: base,
    after: { ...base, currency: "USD" },
  });

  assertEquals(result.map((item) => item.userId), ["u-alex", "u-priya"]);
});

Deno.test("sub-cent floating point noise does not notify", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "updated",
    before: base,
    after: {
      ...base,
      amount: 1200.00001,
      participants: base.participants.map((participant) => ({
        ...participant,
        share: participant.share + 0.00001,
      })),
    },
  });

  assertEquals(result, []);
});

Deno.test("deletion uses the before-state recipient union", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-priya",
    action: "deleted",
    before: base,
    after: null,
  });

  assertEquals(result.map((item) => item.userId), ["u-alex"]);
  assertEquals(result[0].after, null);
});

Deno.test("deletion with zero net position does not notify", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-priya",
    action: "deleted",
    before: {
      ...base,
      participants: [
        { participantId: "p-alex", userId: "u-alex", share: 1200 },
        { participantId: "p-priya", userId: "u-priya", share: 0 },
      ],
      payerParticipantId: "p-alex",
    },
    after: null,
  });

  assertEquals(result, []);
});

Deno.test("income transactions are outside notification scope", () => {
  const result = buildNotificationImpacts({
    actorUserId: "u-other",
    action: "created",
    before: null,
    after: { ...base, type: "income" },
  });

  assertEquals(result, []);
});
