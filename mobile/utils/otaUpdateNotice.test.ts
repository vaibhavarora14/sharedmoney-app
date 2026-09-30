import {
  isOtaIncompatibilityError,
  otaUpdateMessage,
  otaUpdateNotice,
} from "./otaUpdateNotice.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message ?? "values differ"}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("hides OTA status on web and when updates are disabled", () => {
  assertEquals(
    otaUpdateNotice({
      platform: "web",
      isDownloading: true,
      isUpdatePending: true,
    }),
    { kind: "hidden" },
  );
  assertEquals(
    otaUpdateNotice({
      isEnabled: false,
      isDownloading: true,
      isUpdatePending: false,
    }),
    { kind: "hidden" },
  );
});

Deno.test("does not show a banner while only checking for updates", () => {
  assertEquals(
    otaUpdateNotice({
      isEnabled: true,
      isDownloading: false,
      isUpdatePending: false,
    }),
    { kind: "hidden" },
  );
});

Deno.test("shows download progress while an update is fetching", () => {
  const notice = otaUpdateNotice({
    isEnabled: true,
    isDownloading: true,
    isUpdatePending: false,
    downloadProgress: 0.42,
  });
  assertEquals(notice, { kind: "downloading", progressLabel: "42%" });
  assertEquals(otaUpdateMessage(notice), "Downloading update… 42%");
});

Deno.test("prefers restart once the update is ready", () => {
  const notice = otaUpdateNotice({
    isEnabled: true,
    isDownloading: true,
    isUpdatePending: true,
    downloadProgress: 1,
  });
  assertEquals(notice, { kind: "ready" });
  assertEquals(otaUpdateMessage(notice), "Update ready. Tap to restart.");
});

Deno.test("hides after a successful check with no update for this runtime", () => {
  assertEquals(
    otaUpdateNotice({
      isEnabled: true,
      isDownloading: false,
      isUpdatePending: false,
      isUpdateAvailable: false,
      lastCheckForUpdateTimeSinceRestart: new Date("2026-01-01T00:00:00Z"),
    }),
    { kind: "hidden" },
  );
});

Deno.test("points to the store on check or download errors", () => {
  const checkNotice = otaUpdateNotice({
    isEnabled: true,
    isDownloading: false,
    isUpdatePending: false,
    checkError: { message: "network request failed" },
  });
  assertEquals(checkNotice, { kind: "storeRequired", reason: "checkError" });
  assertEquals(
    otaUpdateMessage(checkNotice, "ios"),
    "Couldn't install this update. Get the latest SharedMoney from the App Store.",
  );

  const downloadNotice = otaUpdateNotice({
    isEnabled: true,
    isDownloading: false,
    isUpdatePending: false,
    downloadError: { message: "Failed to download remote update" },
  });
  assertEquals(downloadNotice, {
    kind: "storeRequired",
    reason: "downloadError",
  });
  assertEquals(
    otaUpdateMessage(downloadNotice, "android"),
    "Couldn't install this update. Get the latest SharedMoney from the Play Store.",
  );
});

Deno.test("classifies incompatible runtime errors as store-required", () => {
  assertEquals(
    isOtaIncompatibilityError({
      message: "Update is incompatible with this runtime",
    }),
    true,
  );

  const notice = otaUpdateNotice({
    isEnabled: true,
    isDownloading: false,
    isUpdatePending: true,
    downloadError: { message: "No compatible update for this runtimeVersion" },
  });
  assertEquals(notice, { kind: "storeRequired", reason: "incompatible" });
  assertEquals(
    otaUpdateMessage(notice, "ios"),
    "A newer version is available in the App Store. Tap to update.",
  );
});

Deno.test("explicit no-compatible-update signal shows store CTA", () => {
  const notice = otaUpdateNotice({
    isEnabled: true,
    isDownloading: false,
    isUpdatePending: false,
    noCompatibleUpdate: true,
  });
  assertEquals(notice, { kind: "storeRequired", reason: "none" });
  assertEquals(
    otaUpdateMessage(notice, "android"),
    "A newer version is available in the Play Store. Tap to update.",
  );
});

Deno.test("stops restart loops after reload failure or exhausted attempts", () => {
  assertEquals(
    otaUpdateNotice({
      isEnabled: true,
      isDownloading: false,
      isUpdatePending: true,
      reloadFailed: true,
    }),
    { kind: "storeRequired", reason: "reloadFailed" },
  );

  assertEquals(
    otaUpdateNotice({
      isEnabled: true,
      isDownloading: false,
      isUpdatePending: true,
      restartCount: 1,
    }),
    { kind: "storeRequired", reason: "reloadFailed" },
  );

  // First pending update with no prior reload still offers restart.
  assertEquals(
    otaUpdateNotice({
      isEnabled: true,
      isDownloading: false,
      isUpdatePending: true,
      restartCount: 0,
    }),
    { kind: "ready" },
  );
});

Deno.test("emergency launch asks for a store update", () => {
  assertEquals(
    otaUpdateNotice({
      isEnabled: true,
      isDownloading: false,
      isUpdatePending: false,
      isEmergencyLaunch: true,
    }),
    { kind: "storeRequired", reason: "incompatible" },
  );
});
