# Publishing to Expo

EAS project: `afddb7db-3d7d-46da-a1b5-0d6e4b4374ce`  
Account / slug: `varora1406` / `share-money`  
Android package / iOS bundle: `com.vaibhavarora.sharemoney`

Dashboard: https://expo.dev/accounts/varora1406/projects/share-money  
Updates: https://expo.dev/accounts/varora1406/projects/share-money/updates  
Builds: https://expo.dev/accounts/varora1406/projects/share-money/builds

## OTA updates (EAS Update)

Production binaries check for updates on launch (`ON_LOAD`), download in the
background, and apply the new JS/asset bundle on the **next cold start**. Splash
is not blocked (`fallbackToCacheTimeout: 0`). There is **no in-app OTA chip or
sheet** — updates are silent. Users pick up a downloaded OTA on the next cold
start (force-quit and reopen, or OS kill). Store upgrades for unsupported
binaries use the existing HTTP 426 + `ForceUpdateModal` path only.

`runtimeVersion` uses the `appVersion` policy. An OTA only reaches store
binaries whose marketing version matches `mobile/version.json` at publish time.
Do **not** bump `version.json` for a JS-only OTA.

### What can go OTA

- UI copy, layout, JS bug fixes
- Feature-flag tweaks
- Metro assets already referenced by the bundle

### What needs a store binary

- New or changed native modules
- Expo SDK upgrades, config plugins, permissions
- Icons, splash, push native config, New Architecture
- PostHog (`posthog-react-native` + Expo peer packages such as
  `expo-application` / `expo-localization`) — first enablement needs a new
  store/dev-client binary; subsequent JS-only event tweaks can go OTA
- A new marketing version (users on the old `appVersion` will not receive the OTA)

Users on an unsupported native binary are forced through the existing HTTP 426
+ in-app store modal, not through OTA.

Existing store binaries built with `checkAutomatically: ON_ERROR_RECOVERY` will
not start receiving OTAs until they install a binary produced after that setting
changed to `ON_LOAD`.

### Publish (preferred)

On-demand GitHub Action only — not on every merge to `main`:

1. Actions → **Publish OTA Update** → Run workflow
2. Leave `channel` as `preview` for dogfood, or choose `production` explicitly
3. Set `message` and `git_ref` (default `main`)

Preview builds listen on channel `preview`. Production / store builds listen on
`production`.

### Publish (local)

```bash
cd mobile
# Preview first
npm run update:preview -- --message "fix: describe the change"
# Production
eas update --channel production --message "fix: describe the change"
```

`EXPO_PUBLIC_*` must match the store binary. The GitHub Action exports the
Production environment secrets before bundling.

### Verify

1. Install a binary built after `ON_LOAD` shipped (preview or store)
2. Publish an OTA to that binary's channel
3. Force-quit and reopen the app (or wait for the next cold start) so the
   downloaded update can apply — there is no in-app restart chip
4. Confirm Settings / `VersionDisplay` shows a new short update id

### Rollback

```bash
cd mobile
eas update --channel production --rollback --non-interactive
```

Or republish the last good commit to the same channel. Users pick up the
rollback on the launch after it downloads (second cold start).

## Legacy web redirect

`https://share-money.expo.app` is not the canonical web app. It hosts only a
small path-preserving redirect artifact for old links. New user-facing app links
must use `https://sharedmoney.app/app`.

```bash
npm run deploy:web:expo-redirect
```

The full web app is exported into the Vercel-hosted marketing site with
`npm run export:web:sharedmoney`.

## Production builds (EAS Build)

For store binaries, follow the release-mobile skill. Quick local commands:

```bash
cd mobile
eas build --platform ios --profile production
eas build --platform android --profile production
```

## Environment variables

- Client values must use the `EXPO_PUBLIC_` prefix
- Store builds and OTAs should use the same Production environment secrets
- For local development, create a `.env` file in `mobile/`
- PostHog (SharedMoney Production project `563625`): set
  `EXPO_PUBLIC_POSTHOG_KEY` and optionally `EXPO_PUBLIC_POSTHOG_HOST`
  (`https://us.i.posthog.com`) as EAS secrets for **production** and
  **preview** builds. Do not commit the real key. If the key is unset, the
  SDK is not initialized. Do not use the Paisewise/Glass Money project token.
  After sign-in the app calls `identify(authUserId, { email, name })` so
  support can search persons by email. Local `supabase/seed.sql` user ids
  are never identified (avoids Maestro polluting Production).