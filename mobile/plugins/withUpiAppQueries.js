/**
 * Declares UPI (and WhatsApp) URL schemes so Linking.canOpenURL works.
 * iOS: LSApplicationQueriesSchemes. Android 11+: <queries> intent views.
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
} = require("expo/config-plugins");

const UPI_SCHEMES = ["tez", "gpay", "phonepe", "paytmmp", "bhim", "whatsapp"];

function ensureIosSchemes(config) {
  return withInfoPlist(config, (config) => {
    const existing = config.modResults.LSApplicationQueriesSchemes || [];
    const merged = Array.from(new Set([...existing, ...UPI_SCHEMES]));
    config.modResults.LSApplicationQueriesSchemes = merged;
    return config;
  });
}

function ensureAndroidQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest.queries) {
      manifest.queries = [];
    }
    const queries = Array.isArray(manifest.queries)
      ? manifest.queries
      : [manifest.queries];

    for (const scheme of UPI_SCHEMES) {
      const already = queries.some((entry) => {
        const intents = entry?.intent;
        if (!intents) return false;
        const list = Array.isArray(intents) ? intents : [intents];
        return list.some((intent) => {
          const data = intent?.data;
          const dataList = Array.isArray(data) ? data : data ? [data] : [];
          return dataList.some(
            (d) => d?.$?.["android:scheme"] === scheme,
          );
        });
      });
      if (already) continue;
      queries.push({
        intent: [
          {
            action: [
              {
                $: {
                  "android:name": "android.intent.action.VIEW",
                },
              },
            ],
            data: [
              {
                $: {
                  "android:scheme": scheme,
                },
              },
            ],
          },
        ],
      });
    }

    // Also allow generic upi:// for Android system chooser.
    const hasUpi = queries.some((entry) => {
      const intents = entry?.intent;
      if (!intents) return false;
      const list = Array.isArray(intents) ? intents : [intents];
      return list.some((intent) => {
        const data = intent?.data;
        const dataList = Array.isArray(data) ? data : data ? [data] : [];
        return dataList.some((d) => d?.$?.["android:scheme"] === "upi");
      });
    });
    if (!hasUpi) {
      queries.push({
        intent: [
          {
            action: [
              {
                $: {
                  "android:name": "android.intent.action.VIEW",
                },
              },
            ],
            data: [
              {
                $: {
                  "android:scheme": "upi",
                },
              },
            ],
          },
        ],
      });
    }

    manifest.queries = queries;
    AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    return config;
  });
}

function withUpiAppQueries(config) {
  return ensureAndroidQueries(ensureIosSchemes(config));
}

module.exports = createRunOncePlugin(
  withUpiAppQueries,
  "withUpiAppQueries",
  "1.0.0",
);
