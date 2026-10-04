/**
 * Dynamic Expo configuration that supports both Expo Go and Development Builds
 * 
 * To use Expo Go: Just run `expo start` and scan the QR code
 * To use Development Build: Run `npm run build:android` or `npm run build:ios` first
 */

const fs = require('fs');
const path = require('path');
const { resolveAndroidPushConfig } = require('./config/androidPushConfig.cjs');
const { validateSentryBuildEnvironment } = require('./config/sentryBuildConfig.cjs');

// Read version from version.json
const versionPath = path.join(__dirname, 'version.json');
let versionConfig = { version: '1.0.0', buildNumber: 1 };

try {
  const versionFile = fs.readFileSync(versionPath, 'utf8');
  versionConfig = JSON.parse(versionFile);
  
  // Validate structure
  if (!versionConfig.version || typeof versionConfig.version !== 'string') {
    throw new Error('Invalid version.json: missing or invalid "version" field');
  }
  if (typeof versionConfig.buildNumber !== 'number' || versionConfig.buildNumber < 1) {
    throw new Error('Invalid version.json: missing or invalid "buildNumber" field (must be >= 1)');
  }
  
  // Validate version format (basic check)
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (!versionRegex.test(versionConfig.version)) {
    throw new Error(`Invalid version format: "${versionConfig.version}". Expected MAJOR.MINOR.PATCH`);
  }
} catch (error) {
  // In production builds, fail hard to catch configuration issues early
  const isProduction = process.env.NODE_ENV === 'production' || process.env.EAS_BUILD;
  
  if (isProduction) {
    console.error('ERROR: Could not read or validate version.json:', error.message);
    console.error('This is a production build - version.json is required.');
    process.exit(1);
  } else {
    console.warn('Warning: Could not read version.json, using defaults:', error.message);
    console.warn('This is acceptable in development, but version.json is required for production builds.');
  }
}

module.exports = ({ config }) => {
  validateSentryBuildEnvironment(process.env);

  const androidPushConfig = resolveAndroidPushConfig({
    env: process.env,
    projectRoot: __dirname,
  });

  // Only include expo-dev-client in development builds. EAS sets
  // EAS_BUILD_PROFILE for production too, so check the profile value.
  const isDevelopmentBuild =
    process.env.EAS_BUILD_PROFILE === 'development' ||
    process.env.EXPO_PUBLIC_USE_DEV_CLIENT === 'true';

  // Hostname for Universal Links (iOS) / App Links (Android), used by the
  // group invite-link feature. When unset, only the custom scheme is used.
  let appUrlHostname = null;
  let appLinkPathPrefix = "/join";
  try {
    if (process.env.EXPO_PUBLIC_APP_URL) {
      const appUrl = new URL(process.env.EXPO_PUBLIC_APP_URL);
      appUrlHostname = appUrl.hostname;
      const appPath = appUrl.pathname.replace(/\/+$/, "");
      appLinkPathPrefix = `${appPath === "/" ? "" : appPath}/join`;
    }
  } catch (e) {
    console.warn('Warning: EXPO_PUBLIC_APP_URL is invalid; Universal/App Links disabled');
  }

  const webBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  const webExportBaseUrl =
    webBaseUrl && !/^https?:\/\//i.test(webBaseUrl) ? webBaseUrl : null;
  const appLinkHosts = Array.from(
    new Set([appUrlHostname, "owewho.com"].filter(Boolean))
  );
  const appSchemes = ["sharedmoney", "owewho"];

  // Owner/projectId default only under EAS_BUILD so Expo Go / OSS forks stay
  // unlinked. CI `eas submit` is not an EAS build — export EXPO_OWNER and
  // EAS_PROJECT_ID in those workflow steps instead.
  const expoOwner =
    process.env.EXPO_OWNER ||
    (process.env.EAS_BUILD ? "varora1406" : undefined);
  const easProjectId =
    process.env.EAS_PROJECT_ID ||
    (process.env.EAS_BUILD ? "afddb7db-3d7d-46da-a1b5-0d6e4b4374ce" : undefined);
  const bundleIdentifier =
    process.env.EXPO_PUBLIC_BUNDLE_IDENTIFIER || "com.vaibhavarora.sharemoney";
  const androidPackage =
    process.env.EXPO_PUBLIC_ANDROID_PACKAGE || "com.vaibhavarora.sharemoney";
  const sentryOrg = process.env.SENTRY_ORG || "jobappagent";
  const sentryProject = process.env.SENTRY_PROJECT || "react-native";

  return {
    ...config,
    expo: {
      ...config.expo,
      name: "SharedMoney",
      slug: "share-money",
      ...(expoOwner ? { owner: expoOwner } : {}),
      scheme: appSchemes,
      version: versionConfig.version,
      orientation: "portrait",
      icon: "./assets/icon.png",
      userInterfaceStyle: "automatic", // Respects system dark/light mode preference
      // New Architecture is always on in SDK 55+; do not set newArchEnabled.
      ios: {
        supportsTablet: true,
        bundleIdentifier,
        scheme: appSchemes,
        buildNumber: versionConfig.buildNumber.toString(),
        usesAppleSignIn: true,
        // Avoid App Store Connect manual encryption questionnaire prompts.
        infoPlist: {
          ITSAppUsesNonExemptEncryption: false
        },
        // Universal Links require Associated Domains on the App Store
        // provisioning profile. EAS cannot refresh that profile
        // non-interactively right now, so only enable when explicitly opted in.
        // IMPORTANT: omit the key entirely when disabled — an empty array can
        // still cause prebuild to request the entitlement.
        ...(process.env.EXPO_PUBLIC_ENABLE_ASSOCIATED_DOMAINS === 'true' &&
        appLinkHosts.length > 0
          ? { associatedDomains: appLinkHosts.map((host) => `applinks:${host}`) }
          : {})
      },
      android: {
        package: androidPackage,
        ...androidPushConfig,
        scheme: appSchemes,
        versionCode: versionConfig.buildNumber,
        adaptiveIcon: {
          foregroundImage: "./assets/adaptive-icon.png",
          backgroundColor: "#F7F9FC"
        },
        // edgeToEdgeEnabled removed in SDK 57 — edge-to-edge is mandatory.
        // App Links for invites and one-time bills; requires assetlinks.json at
        // https://<host>/.well-known/assetlinks.json
        intentFilters: appLinkHosts.length > 0
          ? [
              {
                action: "VIEW",
                autoVerify: true,
                data: appLinkHosts.flatMap((host) =>
                  [appLinkPathPrefix, "/split", "/app/split"].map((pathPrefix) => ({
                    scheme: "https",
                    host,
                    pathPrefix
                  }))
                ),
                category: ["BROWSABLE", "DEFAULT"]
              }
            ]
          : []
      },
      web: {
        favicon: "./assets/favicon.png",
        bundler: "metro",
        output: "single"
      },
      ...(webExportBaseUrl
        ? {
            experiments: {
              ...(config.expo?.experiments || {}),
              baseUrl: webExportBaseUrl
            }
          }
        : {}),
      extra: {
        buildProfile: process.env.EAS_BUILD_PROFILE || "development",
        ...(easProjectId ? { eas: { projectId: easProjectId } } : {})
      },
      runtimeVersion: {
        policy: "appVersion"
      },
      ...(easProjectId
        ? {
            updates: {
              url: `https://u.expo.dev/${easProjectId}`,
              enabled: true,
              checkAutomatically: "ON_LOAD",
              fallbackToCacheTimeout: 0
            }
          }
        : {}),
      plugins: [
        './plugins/withStripAssociatedDomains',
        [
          "@sentry/react-native/expo",
          {
            "organization": sentryOrg,
            "project": sentryProject
          }
        ],
        [
          "expo-build-properties",
          {
            "android": {
              "enableMinifyInReleaseBuilds": true,
              "enableShrinkResourcesInReleaseBuilds": true
            }
          }
        ],
        [
          "expo-asset",
          {
            "assets": ["./assets"]
          },
        ],
        [
          "expo-splash-screen",
          {
            image: "./assets/splash-icon.png",
            resizeMode: "contain",
            backgroundColor: "#F7F9FC"
          }
        ],
        "expo-apple-authentication",
        "expo-font",
        "expo-localization",
        "expo-notifications",
        "expo-web-browser",
        // Android Credential Manager Google Sign-In. Optional iOS URL scheme via
        // EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME when native Google on iOS is enabled.
        "./plugins/withNativeGoogleSignIn",
        // iOS 27 / Xcode 27: adopt UIScene lifecycle so App Review launch succeeds
        // (Guideline 2.1 NoSceneLifecycleAdoption). Safe to remove after SDK 58+.
        "./plugins/withIosSceneLifecycle",
        // Only include expo-dev-client plugin for development builds
        ...(isDevelopmentBuild ? ["expo-dev-client"] : [])
      ]
    }
  };
};
