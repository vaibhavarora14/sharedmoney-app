import { assertEquals } from "jsr:@std/assert@1";
import { EDGE_REGION, EDGE_REGION_HEADER } from "./edgeRegion.ts";
import { authenticatedRequestHeaders } from "./authenticatedRequestHeaders.ts";

Deno.test("every authenticated edge request sends x-region: ap-southeast-1", () => {
  const headers = authenticatedRequestHeaders("token", "2.69.3");
  assertEquals(EDGE_REGION_HEADER, "x-region");
  assertEquals(EDGE_REGION, "ap-southeast-1");
  assertEquals(headers[EDGE_REGION_HEADER], EDGE_REGION);
  assertEquals(headers.Authorization, "Bearer token");
  assertEquals(headers["X-App-Version"], "2.69.3");
});

Deno.test("caller headers cannot drop the region pin", () => {
  const headers = authenticatedRequestHeaders("token", "2.69.3", {
    "Content-Type": "application/json",
    [EDGE_REGION_HEADER]: "us-east-1",
  });
  assertEquals(headers[EDGE_REGION_HEADER], "ap-southeast-1");
});
