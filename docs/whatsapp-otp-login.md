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
| `WHATSAPP_MONTHLY_BUDGET_INR` | optional | default `500` — hard IST monthly spend cap (fail closed if invalid) |
| `WHATSAPP_OTP_COST_INR` | optional | default `0.14` — estimated INR per auth template incl. GST |
| `WHATSAPP_OTP_ALLOWED_COUNTRY_CODES` | optional | default `91` — comma/space-separated calling codes |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Already required by other functions |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | yes | Already required |

Invalid `WHATSAPP_MONTHLY_BUDGET_INR` / `WHATSAPP_OTP_COST_INR` / `WHATSAPP_OTP_ALLOWED_COUNTRY_CODES` values **fail closed** (no send). Budget exhaustion and reserve DB errors return **503** with code `WHATSAPP_BUDGET_EXHAUSTED` and message *WhatsApp sign-in is unavailable right now. Please use another sign-in method.* — not `404` / `FEATURE_DISABLED`. The existing Auth UI shows that server message inline; users can still go back to other sign-in methods.

## Spend & abuse controls (server)

On every `action=send`:

1. **Country allow-list** — numbers outside `WHATSAPP_OTP_ALLOWED_COUNTRY_CODES` are rejected (`400`).
2. **Per-IP limit** — `x-forwarded-for` (first hop) is hashed with `WHATSAPP_OTP_PEPPER` into `request_fingerprint` / `ip_hash`; at most **10** sends/hour per IP.
3. **Atomic reserve** — `reserve_whatsapp_otp_send` takes a transaction advisory lock, sums non-`failed` `est_cost_inr` for the current **IST** calendar month, refuses if `spent + cost > budget`, otherwise inserts a `reserved` row. The same lock makes per-phone cooldown (60s) and hourly (5) checks race-safe.
4. After Meta accepts, the row is marked `accepted` with `meta_message_id`; on Meta rejection it is marked `failed` (releases budget).

Approx capacity at defaults: ₹500 / ₹0.14 ≈ **3,500** auth templates / IST month.

## Database

Migration `supabase/migrations/20261020120000_whatsapp_otp_challenges.sql` creates `public.whatsapp_otp_challenges` with:

- `ENABLE ROW LEVEL SECURITY`
- **No** anon/authenticated policies (clients never touch the table)
- Explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated`
- Explicit `GRANT ALL … TO service_role` (and `postgres`)

Migration `supabase/migrations/20261028160000_whatsapp_otp_sends.sql` creates `public.whatsapp_otp_sends` (monthly ledger) with the same RLS / revoke / service_role grant pattern, plus `public.reserve_whatsapp_otp_send(...)` (`SECURITY DEFINER`, `search_path` fixed, **EXECUTE** only for `service_role`).

Apply both on the hosted project when enabling the feature; edge functions use the service role.

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
- [ ] Hosted migrations applied (`whatsapp_otp_challenges` + `whatsapp_otp_sends` / `reserve_whatsapp_otp_send`)
- [ ] Confirm monthly budget defaults (₹500 / ₹0.14 / country `91`) or set edge env overrides — **do not** rely on Meta’s dashboard spend cap
- [ ] `ENABLE_WHATSAPP_OTP_LOGIN=true` on production edge (API)
- [ ] Decide when to set Production `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN` (UI) — keep unset until then
- [ ] OTA / store build that includes the client flag only when intentionally launching
