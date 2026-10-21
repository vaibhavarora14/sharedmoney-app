# Expo Updates: `UNIQUE constraint failed: updates.scope_key, updates.commit_time`

## What failed

Expo Go occasionally surfaces:

```text
There was a problem running 'SharedMoney'.
SQLiteGetResultsError: (code: 19; extendedCode: 2067;
  message: UNIQUE constraint failed: updates.scope_key, updates.commit_time)
```

That is **not** SharedMoney app data. It comes from **expo-updates’ internal SQLite** table `updates`, which has:

```sql
CREATE UNIQUE INDEX "index_updates_scope_key_commit_time"
  ON "updates" ("scope_key", "commit_time");
```

Insert site (iOS): `node_modules/expo-updates/ios/EXUpdates/Database/UpdatesDatabase.swift` → `addUpdate()` (plain `INSERT`, no `OR IGNORE` / `ON CONFLICT`).

## What triggers it

In **development mode** (Expo Go / Metro), `AppLoader` / Android `Loader` used to call `addUpdate` / `insertUpdate` **without** checking whether the row already exists. Production OTA loads check by update id first; the dev path did not.

Rapid Expo Go terminate → reopen / project reloads (e.g. screenshot automation) re-insert the same `(scope_key, commit_time)` and hit the unique index.

## Can real store users hit it?

- **Expo Go / screenshot tooling:** yes — that is how the bad #387 first-crash shots were captured.
- **Production OTA (store builds):** unlikely on this path. Production loaders look up by update id before insert. A server bug that reused `commit_time` under a new id could still race, but that is not our app schema.
- **SharedMoney expense/group data:** no — unrelated table.

## Does it escape our React ErrorBoundary?

**Yes.** It fails in native expo-updates / Expo Go project loading, before or outside the JS tree. Expo Go then paints its own “There was a problem running…” overlay (or “Loading project…” splash). Our `CrashErrorFallback` never mounts.

## Fix in this repo

`patches/expo-updates+57.0.24.patch` makes the **development-mode** insert path:

1. Skip insert when the update id is already stored (same idea as production).
2. If a UNIQUE constraint still races, log and continue instead of failing the load.

This applies to **native builds that compile expo-updates from source** (dev client / store). Prebuilt **Expo Go** binaries will not pick it up until Expo ships a similar fix; for screenshots, wait for the in-app crash UI (`Something went wrong`) and do not treat Expo Go’s overlay as our crash screen.
