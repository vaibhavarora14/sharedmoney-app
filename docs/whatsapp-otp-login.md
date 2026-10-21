# WhatsApp OTP phone login (feature-flagged)

End-to-end phone login via Meta WhatsApp Cloud API. **Off by default** in client builds. The edge function is separately gated by `ENABLE_WHATSAPP_OTP_LOGIN`.

Related: #359 (umbrella), #360 (connection), PR #363.

## Delivery (production)

Template **`sharedmoney_otp`** is **APPROVED** (en, AUTHENTICATION, copy-code, 10-minute expiry). Production edge secrets use:

| Secret | Production value |
|---|---|
| `WHATSAPP_OTP_DELIVERY` | `template` |
| `WHATSAPP_PHONE_NUMBER_ID` | `1321273467743837` |
| `WHATSAPP_WABA_ID` | `1649459676786260` |
| `WHATSAPP_OTP_TEMPLATE_NAME` | `sharedmoney_otp` (default) |
| `WHATSAPP_OTP_TEMPLATE_LANG` | `en` (default) |

Also required: `WHATSAPP_TOKEN`, `WHATSAPP_OTP_PEPPER`, and `ENABLE_WHATSAPP_OTP_LOGIN=true` for the edge function to accept requests.

`WHATSAPP_OTP_DELIVERY=text` remains available for Meta allowlisted **test** recipients only (script / local). Free-form text is not the production path.

## Feature flags (both must be on for a full path)

| Layer | Variable | What it gates |
|---|---|---|
| Edge function | `ENABLE_WHATSAPP_OTP_LOGIN` | **Server-only.** Must be exactly `true` or `whatsapp-otp` returns **404**. Does **not** show any UI. |
| Mobile / web Expo | `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN` | **Client-only.** Must be exactly `true` or the “Continue with WhatsApp” entry stays hidden on Auth. |

Merging this PR does **not** expose phone login to users unless Production EAS/web builds also set `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true`. That client flag is unset in committed configs (only commented in `.env.example`).

Existing Google / Apple / email login is unchanged when either flag is off.

## Env / secrets checklist

### Client (EAS Preview / local `.env` only — leave unset in Production store / web builds until go-live)

```bash
EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true
EXPO_PUBLIC_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

### Supabase Edge Function secrets

| Secret | Required | Purpose |
|---|---|---|
| `ENABLE_WHATSAPP_OTP_LOGIN` | yes to enable API | Must be exactly `true` or function returns 404 |
| `WHATSAPP_TOKEN` | yes | Meta system-user / access token (never commit/print) |
| `WHATSAPP_PHONE_NUMBER_ID` | yes for live send | Production: `1321273467743837` |
| `WHATSAPP_WABA_ID` | optional | Production WABA `1649459676786260` (dashboard ops) |
| `WHATSAPP_OTP_PEPPER` | yes | Server-only pepper for hashing OTPs |
| `WHATSAPP_OTP_DELIVERY` | production: `template` | `template` (prod) or `text` (Meta test recipients) |
| `WHATSAPP_OTP_TEMPLATE_NAME` | optional | default `sharedmoney_otp` |
| `WHATSAPP_OTP_TEMPLATE_LANG` | optional | default `en` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Already required by other functions |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | yes | Already required |

## Database

Migration `supabase/migrations/20261020120000_whatsapp_otp_challenges.sql` creates `public.whatsapp_otp_challenges` with:

- `ENABLE ROW LEVEL SECURITY`
- **No** anon/authenticated policies (clients never touch the table)
- Explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated`
- Explicit `GRANT ALL … TO service_role` (and `postgres`)

Apply on the hosted project when enabling the feature; edge functions use the service role.

## Local / Meta-test flip-on

```bash
# mobile/.env (gitignored)
EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true

# supabase secrets / supabase/.env for functions serve
ENABLE_WHATSAPP_OTP_LOGIN=true
WHATSAPP_OTP_DELIVERY=text          # Meta allowlisted test recipients
WHATSAPP_OTP_PEPPER=dev-only-long-random-pepper
WHATSAPP_TOKEN=…                    # env-only; never commit/print
WHATSAPP_PHONE_NUMBER_ID=…          # Meta test phone number ID when using text
```

## Live send+verify script

`scripts/whatsapp-otp-test.sh` wires Meta **test** send+verify. It:

- requires `WHATSAPP_TOKEN` and `TEST_RECIPIENT_PHONE`
- defaults to **local** Supabase (`supabase start` + migration + `functions serve`)
- sets `ENABLE_WHATSAPP_OTP_LOGIN=true`, `WHATSAPP_OTP_DELIVERY=text`, and generates `WHATSAPP_OTP_PEPPER` if unset
- **refuses** the production project ref
- never prints the access token

```bash
export WHATSAPP_TOKEN='…'
export TEST_RECIPIENT_PHONE='+91XXXXXXXXXX'
./scripts/whatsapp-otp-test.sh
```

## Go-live checklist (owner)

- [x] Template `sharedmoney_otp` approved
- [x] Production phone number ID / WABA / token / pepper / `WHATSAPP_OTP_DELIVERY=template` secrets
- [ ] Hosted migration applied
- [ ] `ENABLE_WHATSAPP_OTP_LOGIN=true` on production edge (API)
- [ ] Decide when to set Production `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN` (UI) — keep unset until then
- [ ] OTA / store build that includes the client flag only when intentionally launching
