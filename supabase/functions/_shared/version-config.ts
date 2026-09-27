/**
 * Version Configuration
 * 
 * This file controls which app versions are allowed to use the API.
 * Update MIN_SUPPORTED_VERSION when deploying breaking changes.
 */

export const VERSION_CONFIG = {
  // Minimum app version required to use the API
  // Apps below this version will receive HTTP 426 (Upgrade Required)
  // Format: MAJOR.MINOR.PATCH (semver)
  MIN_SUPPORTED_VERSION: "2.5.0",

  // Current latest version (informational)
  LATEST_VERSION: "2.31.1",

  // Message shown to users who need to update
  UPDATE_MESSAGE: "Please update your app to continue using SharedMoney.",

  // Store URLs for download
  STORE_URL_IOS: "https://apps.apple.com/app/id6755923591",
  STORE_URL_ANDROID: "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney",
};
