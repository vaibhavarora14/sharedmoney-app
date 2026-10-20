# WhatsApp OTP phone login (feature-flagged, test-only)

End-to-end phone login via Meta WhatsApp Cloud API. **Off by default** in production builds. Do not enable for real users until Meta business verification and the `sharedmoney_otp` template are approved.

Related: #359 (umbrella), #360 (connection), PR that continues this work.

## Delivery decision (no approved custom template yet)

| Option | Can carry a real OTP? | Notes |
|---|---|---|
| `hello_world` pre-approved template | No | No body parameters for a code |
| Custom AUTHENTICATION template `sharedmoney_otp` | Yes | Blocked on Meta business verification / template approval |
| Free-form **text** to Meta allowlisted test recipients | Yes | **Chosen for test** via `WHATSAPP_OTP_DELIVERY=text` (default) |

Once `sharedmoney_otp` is approved, set `WHATSAPP_OTP_DELIVERY=template` (and optionally `WHATSAPP_OTP_TEMPLATE_NAME=sharedmoney_otp`). No code change required.

Meta may require the test recipient to message the business test number first (opens a 24h session) before free-form text succeeds. Template mode does not need that window.

## Feature flags (both must be on for a full path)

| Layer | Variable | Production default |
|---|---|---|
| Mobile / web Expo | `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN` | unset / not `true` → WhatsApp entry hidden |
| Edge function | `ENABLE_WHATSAPP_OTP_LOGIN` | unset / not `true` → `whatsapp-otp` returns 404 |

Existing Google / Apple / email login is unchanged when either flag is off.

## Env / secrets checklist

### Client (EAS Preview / local `.env` only — never Production store builds)

```bash
EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true
EXPO_PUBLIC_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

### Supabase Edge Function secrets

| Secret | Required | Purpose |
|---|---|---|
| `ENABLE_WHATSAPP_OTP_LOGIN` | yes for test | Must be exactly `true` |
| `WHATSAPP_TOKEN` | yes | Meta temporary or system-user access token (never commit/print) |
| `WHATSAPP_PHONE_NUMBER_ID` | yes for live send | Test phone number ID; default `1325245927345802` in the test script |
| `WHATSAPP_WABA_ID` | optional | Test WABA `27639098452432498` (dashboard ops; not required by OTP send) |
| `WHATSAPP_OTP_PEPPER` | yes | Server-only pepper for hashing OTPs (long random string) |
| `WHATSAPP_OTP_DELIVERY` | optional | `text` (default) or `template` |
| `WHATSAPP_OTP_TEMPLATE_NAME` | optional | default `sharedmoney_otp` |
| `WHATSAPP_OTP_TEMPLATE_LANG` | optional | default `en` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Already required by other functions |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | yes | Already required |

Optional: `WHATSAPP_WABA_ID` (WABA id for dashboard ops; not read by OTP send).

## Meta dashboard steps (owner)

1. Open [Meta for Developers](https://developers.facebook.com/) → your SharedMoney app → **WhatsApp → API Setup**.
2. Copy the **Phone number ID** (test number) into `WHATSAPP_PHONE_NUMBER_ID`.
3. Generate a **temporary access token** (or create a system user token) → `WHATSAPP_TOKEN`. Temporary tokens expire ~24h.
4. Under **To**, add up to 5 **test recipient** phone numbers.
5. Meta sends each recipient a confirmation code — **the owner (or recipient) must enter that code in the dashboard** to verify the number. Agents cannot complete this step.
6. For text delivery: have the verified recipient send any message (e.g. `hi`) to the Meta test business number to open the customer-care window, then request an OTP from the app.
7. Business verification + `sharedmoney_otp` AUTHENTICATION template approval remain founder-owned before production.

## Database

Migration `supabase/migrations/20261020120000_whatsapp_otp_challenges.sql` creates `public.whatsapp_otp_challenges` with RLS enabled, **no** anon/authenticated policies, and explicit `GRANT ALL … TO service_role`.

**Do not apply this migration to hosted/production Supabase from this agent.** Apply only on a local or dedicated test project when exercising the live send path.

## Local test flip-on

```bash
# mobile/.env (gitignored)
EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true

# supabase secrets / supabase/.env for functions serve
ENABLE_WHATSAPP_OTP_LOGIN=true
WHATSAPP_OTP_DELIVERY=text
WHATSAPP_OTP_PEPPER=dev-only-long-random-pepper
WHATSAPP_TOKEN=…                          # env-only; never commit/print
WHATSAPP_PHONE_NUMBER_ID=1325245927345802 # Meta test number (non-secret)
# WHATSAPP_WABA_ID=27639098452432498      # optional dashboard reference
```

## Meta test number (non-secret IDs)

SharedMoney’s Meta **test** WhatsApp Cloud API number (safe to commit; not credentials):

| Field | Value |
|---|---|
| Phone number ID | `1325245927345802` |
| WABA ID | `27639098452432498` |
| Test From number | `+1 555 636 4333` |

The **access token** is secret: set only via `WHATSAPP_TOKEN` env / Supabase secrets. Never commit or print it.

## Live send+verify script (token + test recipient)

`scripts/whatsapp-otp-test.sh` wires everything else for a Meta **test recipient** send+verify. It:

- requires `WHATSAPP_TOKEN` and `TEST_RECIPIENT_PHONE`
- defaults `WHATSAPP_PHONE_NUMBER_ID` to the test ID above (override if needed)
- defaults to **local** Supabase (`supabase start` + migration up + `functions serve`)
- sets `ENABLE_WHATSAPP_OTP_LOGIN=true`, `WHATSAPP_OTP_DELIVERY=text`, and generates `WHATSAPP_OTP_PEPPER` if unset
- **refuses** production project ref `xesuklogveedeppxbbit` (and any `SUPABASE_URL` containing it)
- never prints the access token

```bash
export WHATSAPP_TOKEN='…'                    # Meta temporary or system-user token (env-only)
export TEST_RECIPIENT_PHONE='+91XXXXXXXXXX'  # allowlisted + verified in Meta dashboard
# optional override; script defaults to 1325245927345802
# export WHATSAPP_PHONE_NUMBER_ID='1325245927345802'

./scripts/whatsapp-otp-test.sh
# After the WhatsApp message arrives:
# enter the 6-digit code when prompted
# or: VERIFY_CODE=123456 ./scripts/whatsapp-otp-test.sh
```

Non-local test project (still not production):

```bash
export SUPABASE_PROJECT_REF='your-non-prod-ref'
export SUPABASE_URL='https://your-non-prod-ref.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='…'
# Also set WhatsApp + ENABLE_WHATSAPP_OTP_LOGIN secrets on that project and apply the OTP migration there.
./scripts/whatsapp-otp-test.sh
```

## Still blocked on Meta

- Business verification
- Approval of production template `sharedmoney_otp`
- Going live / production flag-on / OTA or store build with the client flag

## Owner-only actions

- Verify test recipient codes in Meta dashboard
- Create/rotate Meta access tokens
- Complete business verification and submit/approve `sharedmoney_otp`
- Decide when to set Production `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN` (should stay unset until then)
