# First-crash reshoot (expo-updates UNIQUE follow-up)

## Artifacts (exact names)

- `03-crash-first-light.png`
- `08-crash-first-dark.png`

Also at `/tmp/cursor-artifacts/issue-388/` and `/tmp/cursor-artifacts/`.

## How captured

iPhone Simulator (PR386 iPhone 17 Pro), Expo Go, **without** terminate/reopen cycles.
Maestro opened `?preview=crash-first` (in-app `CrashErrorFallback` preview — ErrorBoundary path, no support ID) and asserted:

- Visible: SharedMoney, Something went wrong, safe-expenses copy, Reload
- Not visible: Expo “There was a problem running…”, “Loading project…”, Contact support, SM-7K3Q-92, SQLite

## Related

See `docs/expo-updates-dev-unique-constraint.md` for the SQLite UNIQUE root cause.
