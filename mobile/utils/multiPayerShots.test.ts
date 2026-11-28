import { assertEquals } from "jsr:@std/assert@1";
import { readMultiPayerShot } from "./multiPayerShots.ts";

Deno.test("multi-payer shots come from the shot query param", () => {
  assertEquals(readMultiPayerShot("?preview=multi-payer&shot=add-amount"), "add-amount");
  assertEquals(readMultiPayerShot("?preview=multi-payer&shot=add-shares"), "add-shares");
  assertEquals(readMultiPayerShot("?preview=multi-payer&shot=list"), "list");
  assertEquals(readMultiPayerShot("?preview=multi-payer&shot=detail"), "detail");
  assertEquals(readMultiPayerShot("?preview=multi-payer&shot=balances"), "balances");
  assertEquals(readMultiPayerShot("?preview=multi-payer"), "add-single");
});
