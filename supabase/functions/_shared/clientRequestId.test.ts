import { assertEquals } from "jsr:@std/assert@1";
import {
  isoDateWithinHorizon,
  isUniqueViolation,
  parseClientRequestId,
} from "./clientRequestId.ts";

Deno.test("a missing idempotency key is allowed", () => {
  assertEquals(parseClientRequestId(undefined), { ok: true, id: null });
  assertEquals(parseClientRequestId(null), { ok: true, id: null });
  assertEquals(parseClientRequestId(""), { ok: true, id: null });
});

Deno.test("an idempotency key must be a UUID", () => {
  assertEquals(parseClientRequestId("not-a-uuid").ok, false);
  assertEquals(
    parseClientRequestId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    { ok: true, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  );
});

Deno.test("a quick settle date cannot be clearly in the future", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  assertEquals(isoDateWithinHorizon("2026-11-18", now), true);
  assertEquals(isoDateWithinHorizon("2026-11-17", now), true);
  assertEquals(isoDateWithinHorizon("2026-11-19", now), true);
  assertEquals(isoDateWithinHorizon("2026-11-21", now), false);
  assertEquals(isoDateWithinHorizon("18-11-2026", now), false);
});

Deno.test("unique violations are the idempotency replay signal", () => {
  assertEquals(isUniqueViolation({ code: "23505" }), true);
  assertEquals(isUniqueViolation({ code: "23503" }), false);
  assertEquals(isUniqueViolation(null), false);
});
