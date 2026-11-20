import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compareMarketingVersions,
  isStoreVersionNewer,
  parseITunesStoreVersion,
  parseMarketingVersion,
  parsePlayStoreVersion,
  shouldOfferUpdatePrompt,
  updatePromptShownKey,
} from "./inAppUpdateEligibility.ts";

const base = {
  platform: "android",
  currentVersion: "2.30.6",
  storeVersion: "2.60.1",
  alreadyPromptedForCurrentVersion: false,
  inOnboarding: false,
  transactionType: "expense",
} as const;

Deno.test("parseMarketingVersion accepts x.y.z and strips suffixes", () => {
  assertEquals(parseMarketingVersion("2.60.1"), "2.60.1");
  assertEquals(parseMarketingVersion(" 2.30.6 "), "2.30.6");
  assertEquals(parseMarketingVersion("2.60.1 (191)"), "2.60.1");
  assertEquals(parseMarketingVersion("2.5"), null);
  assertEquals(parseMarketingVersion(""), null);
});

Deno.test("compareMarketingVersions orders store builds", () => {
  assertEquals(compareMarketingVersions("2.30.6", "2.46.0")! < 0, true);
  assertEquals(compareMarketingVersions("2.46.0", "2.46.0"), 0);
  assertEquals(compareMarketingVersions("2.60.1", "2.46.0")! > 0, true);
  assertEquals(compareMarketingVersions("nope", "2.46.0"), null);
});

Deno.test("isStoreVersionNewer is true only when the store is ahead", () => {
  assertEquals(isStoreVersionNewer("2.30.6", "2.60.1"), true);
  assertEquals(isStoreVersionNewer("2.60.1", "2.60.1"), false);
  assertEquals(isStoreVersionNewer("2.62.1", "2.60.1"), false);
  assertEquals(isStoreVersionNewer("2.30.6", null), false);
});

Deno.test("shouldOfferUpdatePrompt after an expense when the store is newer", () => {
  assertEquals(shouldOfferUpdatePrompt(base), true);
  assertEquals(shouldOfferUpdatePrompt({ ...base, platform: "web" }), false);
  assertEquals(shouldOfferUpdatePrompt({ ...base, inOnboarding: true }), false);
  assertEquals(shouldOfferUpdatePrompt({ ...base, transactionType: "settlement" }), false);
  assertEquals(
    shouldOfferUpdatePrompt({ ...base, alreadyPromptedForCurrentVersion: true }),
    false,
  );
  assertEquals(shouldOfferUpdatePrompt({ ...base, storeVersion: "2.30.6" }), false);
});

Deno.test("parseITunesStoreVersion reads results[0].version", () => {
  assertEquals(
    parseITunesStoreVersion({ resultCount: 1, results: [{ version: "2.60.1" }] }),
    "2.60.1",
  );
  assertEquals(parseITunesStoreVersion({ resultCount: 0, results: [] }), null);
  assertEquals(parseITunesStoreVersion("nope"), null);
});

Deno.test("parsePlayStoreVersion accepts known Play HTML shapes", () => {
  assertEquals(
    parsePlayStoreVersion('<div itemprop="softwareVersion" content="2.60.1">'),
    "2.60.1",
  );
  assertEquals(
    parsePlayStoreVersion("Current Version</div><span>2.60.1</span>"),
    "2.60.1",
  );
  assertEquals(parsePlayStoreVersion('[[["2.60.1"]]]'), "2.60.1");
  assertEquals(parsePlayStoreVersion("<html>no version here</html>"), null);
});

Deno.test("updatePromptShownKey is scoped to the installed version", () => {
  assertEquals(
    updatePromptShownKey("2.60.1"),
    "@sharedmoney/app_update_prompt_shown:2.60.1",
  );
});
