# Contributing to SharedMoney

Thank you for your interest in contributing to SharedMoney! SharedMoney is a modern, collaborative expense tracker and debt-settlement platform built with React Native (Expo), Vite/React, Supabase (PostgreSQL + Edge Functions), and TypeScript.

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE). By contributing, you agree that your contributions will be licensed under the AGPL-3.0.

---

## 🛠️ Prerequisites

Before you get started, ensure you have the following installed:

1. **Node.js** (v20 or v22 LTS recommended) & `npm` (v10+)
2. **Docker Desktop** (required to run Supabase locally)
3. **Supabase CLI** (installed automatically via devDependencies, or install globally via `brew install supabase/tap/supabase`)
4. **Deno** (v2.x, for running Edge Function and backend test suites locally)
5. **Expo Go** or an Android/iOS emulator/simulator (for running the mobile app)

---

## 🚀 Local Development Setup

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/onima-tech/sharedmoney-app.git
cd sharedmoney-app
npm install
```

This workspace uses npm workspaces. A single `npm install` installs dependencies across the root, `mobile/`, and `web/` packages, and applies necessary local patches via `patch-package`.

### 2. Start Local Supabase Services

Ensure Docker is running, then start the local Supabase stack:

```bash
npx supabase start
```

Once started, local endpoints will be available:
- **API URL**: `http://127.0.0.1:54321`
- **Database URL**: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- **Studio Dashboard**: `http://127.0.0.1:54323`
- **Inbucket Local Mailbox**: `http://127.0.0.1:54324`

### 3. Reset and Seed Database

To apply all database migrations and populate the test seed dataset:

```bash
npx supabase db reset --local
```

This sets up:
- 4 test accounts:
  - `alice@test.com` (password: `testpassword123`)
  - `bob@test.com` (password: `testpassword123`)
  - `charlie@test.com` (password: `testpassword123`)
  - `diana@test.com` (password: `testpassword123`)
- Sample groups, expense splits, and settlement transfers.

### 4. Configure Environment Variables

Copy the example environment files:

```bash
cp .env.example .env
cp mobile/.env.example mobile/.env
cp web/.env.example web/.env
```

The default values in the example files are preconfigured for local development without needing paid third-party accounts (PostHog, Sentry, Resend, and Expo Push gracefully default to local/mock mode).

### 5. Running the Apps

Start the services in separate terminal tabs:

```bash
# 1. Supabase Edge Functions server
npm run dev:server

# 2. Mobile App (Expo)
npm run dev:mobile

# 3. Web Landing & Marketing App (Vite)
npm run dev:web
```

---

## 🧪 Testing & Code Quality

Always run the full suite before opening a pull request:

```bash
# Run all tests (web vitest, mobile config tests, deno unit tests)
npm test

# Run TypeScript typechecks across workspaces
npm run typecheck

# Run linter
npm run lint
```

You can also run individual test suites:
- `npm run test:web` – Web frontend unit tests (Vitest)
- `npm run test:mobile` – Mobile config & push verification tests
- `npm run test:deno` – Edge Function & ledger calculation tests (Deno)

---

## 📝 Commit & PR Guidelines

### Commit Messages

This repository adheres to the [Conventional Commits](https://www.conventionalcommits.org/) specification. Pull request titles must begin with one of the following prefixes:

- `feat:` or `feat(scope):` – A new feature (triggers a minor version bump)
- `fix:` or `fix(scope):` – A bug fix (triggers a patch version bump)
- `chore:` or `chore(scope):` – Maintenance or tooling updates
- `docs:` or `docs(scope):` – Documentation changes
- `refactor:` or `refactor(scope):` – Code refactoring without behavior changes
- `test:` or `test(scope):` – Adding or fixing tests
- Breaking changes: append an exclamation mark, e.g. `feat!: replace legacy balance calculator` (triggers a major version bump).

Our automated CI pipeline (`pr-version-bump.yml`) evaluates PR titles and syncs version metadata accordingly.

### Pull Request Checklist

When submitting a PR, make sure:
1. All automated checks (`npm test`, `npm run typecheck`, `npm run lint`) pass cleanly.
2. No proprietary tokens, secrets, personal API credentials, or personal email addresses are included in code or commits.
3. New features include corresponding unit tests where appropriate.
4. Your pull request references any related issues (e.g., `Fixes #123`).

---

## 🛡️ Community & Code of Conduct

All contributors are expected to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md). Please report any unacceptable behavior to [contact@sharedmoney.app](mailto:contact@sharedmoney.app).
