export const STORE_URL_ANDROID =
  "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney";

export const STORE_URL_IOS = "https://apps.apple.com/app/id6755923591";

export function storeUrlForPlatform(platform: string): string {
  return platform === "ios" ? STORE_URL_IOS : STORE_URL_ANDROID;
}
