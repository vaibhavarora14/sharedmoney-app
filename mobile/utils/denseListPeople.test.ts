import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  densePeopleForExpense,
  densePeopleForPayment,
  densePeopleFromBalances,
  fallbackDensePerson,
} from "./denseListPeople.ts";

Deno.test("balance people skip blanks and keep first avatar per person", () => {
  const people = densePeopleFromBalances([
    { user_id: "u-asha", full_name: "Asha Rao", avatar_url: "https://example.com/a.png" },
    { user_id: "u-asha", full_name: "Asha Rao", avatar_url: null },
    { user_id: "u-rohan", full_name: "Rohan Iyer", avatar_url: null },
    { user_id: "u-skip", full_name: null, email: null },
  ]);
  assertEquals(people.map((person) => person.name), ["Asha Rao", "Rohan Iyer"]);
  assertEquals(people[0].avatarUrl, "https://example.com/a.png");
});

Deno.test("home stacks skip the viewer so titles show other people", () => {
  const people = densePeopleFromBalances([
    { user_id: "u-you", full_name: "You" },
    { user_id: "u-asha", full_name: "Asha Rao" },
    { user_id: "u-rohan", full_name: "Rohan Iyer" },
  ], { excludeUserId: "u-you" });
  assertEquals(people.map((person) => person.name), ["Asha Rao", "Rohan Iyer"]);
});

Deno.test("expense rows stack split people when there are two or more", () => {
  const people = densePeopleForExpense({
    payerName: "Rohan",
    paidByParticipantId: "p-rohan",
    splits: [
      { participant_id: "p-me", user_id: "me", full_name: "You" },
      { participant_id: "p-rohan", user_id: "rohan", full_name: "Rohan Iyer" },
    ],
  });
  assertEquals(people.length, 2);
  assertEquals(people[1].name, "Rohan Iyer");
});

Deno.test("expense rows stack payers when two or more people paid", () => {
  const people = densePeopleForExpense({
    payerName: "Asha",
    paidByParticipantId: "p-asha",
    payers: [
      { participant_id: "p-asha", user_id: "u-asha", full_name: "Asha Rao" },
      { participant_id: "p-rohan", user_id: "u-rohan", full_name: "Rohan Iyer" },
    ],
    splits: [
      { participant_id: "p-me", user_id: "me", full_name: "You" },
      { participant_id: "p-asha", user_id: "u-asha", full_name: "Asha Rao" },
      { participant_id: "p-rohan", user_id: "u-rohan", full_name: "Rohan Iyer" },
      { participant_id: "p-meera", user_id: "u-meera", full_name: "Meera Shah" },
    ],
  });
  assertEquals(people.map((person) => person.name), ["Asha Rao", "Rohan Iyer"]);
});

Deno.test("expense row falls back to the payer when splits are missing", () => {
  const people = densePeopleForExpense({
    payerName: "Meera",
    paidByParticipantId: "p-meera",
    splits: null,
  });
  assertEquals(people, [fallbackDensePerson("p-meera", "Meera")]);
});

Deno.test("payment rows show from and to people", () => {
  const people = densePeopleForPayment({
    fromName: "Asha",
    toName: "Rohan",
    fromParticipantId: "p-asha",
    toParticipantId: "p-rohan",
    participants: [
      { id: "p-asha", full_name: "Asha Rao", avatar_url: null },
      { id: "p-rohan", full_name: "Rohan Iyer", avatar_url: null },
    ],
  });
  assertEquals(people.map((person) => person.name), ["Asha Rao", "Rohan Iyer"]);
});
