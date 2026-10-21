# PR #387 screenshots (issue #377)

Captured on iOS Simulator **PR386 iPhone 17 Pro** via Expo Go.

| File | What |
|------|------|
| `01-dead-bill-link-light.png` | Dead bill link (light) |
| `02-bill-offline-light.png` | Offline bill link + Retry (light) |
| `03-crash-first-light.png` | First crash (no support ID) (light) |
| `04-crash-repeat-light.png` | Repeat crash with `SM-7K3Q-92` + Contact support (light) |
| `05-crash-copied-toast-light.png` | Repeat crash after tap-to-copy (“Copied” toast) (light) |
| `06-dead-bill-link-dark.png` | Dead bill link (dark) |
| `07-bill-offline-dark.png` | Offline bill link (dark) |
| `08-crash-first-dark.png` | First crash (dark) |
| `09-crash-repeat-dark.png` | Repeat crash (dark) |
| `10-crash-copied-toast-dark.png` | Copied toast (dark) |

**Not captured:** Contact support Mail compose — iOS Simulator has no Mail account/`mailto` handler (OSStatus -10814). Android dark crash shot skipped (emulator up but Expo Go not installed).

Dev-only triggers (stripped outside `__DEV__`): `exp://…/--/?preview=bill-dead|bill-offline|crash-first|crash-repeat|crash-copied` or `…/dev/crash` for a real throw.
