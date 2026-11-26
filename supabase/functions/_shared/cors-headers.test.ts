import { assertEquals } from "jsr:@std/assert@1";
import {
  CORS_ALLOW_HEADERS_DEFAULT,
  resolveAllowHeaders,
} from "./cors-headers.ts";

Deno.test("default CORS headers include x-region without a preflight list", () => {
  assertEquals(resolveAllowHeaders(null), CORS_ALLOW_HEADERS_DEFAULT);
  assertEquals(resolveAllowHeaders(""), CORS_ALLOW_HEADERS_DEFAULT);
  assertEquals(CORS_ALLOW_HEADERS_DEFAULT.includes("x-region"), true);
});

Deno.test("echoed preflight headers still allow x-region", () => {
  const echoed = resolveAllowHeaders("authorization, content-type");
  assertEquals(echoed.toLowerCase().includes("x-region"), true);
  assertEquals(echoed.toLowerCase().includes("authorization"), true);
  assertEquals(echoed.toLowerCase().includes("content-type"), true);
});
