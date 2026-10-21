# PR #387 screenshots (issue #377 Design follow-ups)

Captured on iOS Simulator **PR386 iPhone 17 Pro** via Expo Go.

| File | What |
|------|------|
| `01-dead-bill-link-light.png` | Dead bill — header **One-time bill**, CTA **Go to Home** (light) |
| `02-bill-offline-light.png` | Offline + Retry (light) |
| `03-crash-first-light.png` | First crash — logo mark, full-width Reload (light) |
| `04-crash-repeat-light.png` | Repeat crash — `SM-7K3Q-92` + Contact support (light) |
| `06-dead-bill-link-dark.png` | Dead bill (dark) |
| `07-bill-offline-dark.png` | Offline (dark) |
| `08-crash-first-dark.png` | First crash (dark) |
| `09-crash-repeat-dark.png` | Repeat crash (dark) |
| `12-cold-start-back-to-home.png` | After cold-start deep link, Back → sign-in Home |

## Cold-start back proof

Maestro flow (sim): stop Expo Go → open `exp://127.0.0.1:8082/--/?preview=bill-dead` → assert dead-link copy → tap `split-bill-back` → assert **Log in to SharedMoney**. See `12-cold-start-back-to-home.png`.

Deep-link bill entry uses `presentation="root"` (no Modal back stack); Back / Go to Home call `dismissBillLinkToHome` → groups route or sign-in when logged out.

## Skipped

- **Android dark crash**: emulator online, Expo Go not installed.
- **Copied toast / mailto**: unchanged from prior pass; not re-requested in this Design follow-up.
