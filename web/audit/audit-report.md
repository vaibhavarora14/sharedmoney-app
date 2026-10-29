# SharedMoney marketing site visual audit

**Scope:** `https://sharedmoney.app` marketing routes (web code in `web/`), not the Expo `/app` product.  
**Mode:** Audit + proposal finished. Palette implementation is **blocked** until Design forwards a direction.  
**Audit branch:** `cursor/site-revamp-audit` (docs only).  
**Ship branch (when unblocked):** `cursor/site-revamp` as **one** draft PR that folds in #432 + #422 + the chosen visual system. Title must **not** contain `preview` (avoids Vercel preview deploy).  
**Date:** 2026-10-29  
**Method:** Playwright Chromium at 375×667, 390×844, 1440×900; light + dark; axe-core WCAG 2.2 AA tags; relative-luminance contrast (WCAG 2).

Copy note: this report avoids em dashes and the word "beta".

---

## Executive summary

Vaibhav's read that "colors are not contrasting well" is mostly about **structure**, not body ink:

1. **Borders and separators fail UI contrast hard** (`#d8e0ec` on white = **1.33:1**, need 3:1). Cards, proof strip, tool cards, and footer hairlines nearly vanish, so sections feel like one flat wash.
2. **Canvas / surface / surface-alt are almost the same** (surface vs canvas **1.05:1**). Hierarchy relies on borders that are too light, so the page looks washed out.
3. **Brand blue on blue wash fails AA** (`#1f5eff` on `#eaf0ff` = **4.49:1**, axe 4.48). Kickers and the Dinner Groups tab on home fail.
4. **Berry coral as text fails AA** (`#c95872` on white = **4.10:1**).
5. Body ink (`#17202a`) and muted (`#526074`) on canvas/surface mostly **pass** AA. The site does not feel low-contrast because paragraphs fail; it feels low-contrast because **edges and accents** do.

**PR #432** (in flight, `cursor/seo-no-limits-line` @ `4f28719`) sets `.route-hero-body` to `--color-text-subtle` `#526074` / `rgb(82,96,116)` on the SEO hero gradient. Against gradient stops that pair **passes AA** (see table). It is still a hierarchy demotion vs today's ink-on-gradient (~14:1).

**Proposed primary direction:** *Sharper Pocket* (Electric Pocket DNA, deeper borders, AAA-capable muted, brand blue that clears wash). Optional alternate: *Soft Ledger*. **Do not apply either palette until Design picks a direction.**

**Ship shape:** the full sharedmoney.app revamp is **one change** on `cursor/site-revamp` (draft PR, no `preview` in the name). Fold draft PRs **#432** and **#422** into that branch; they will not merge on their own. See [Folding / ship plan](#folding--ship-plan).

---

## Folding / ship plan

Vaibhav: the whole marketing revamp ships as **one** change. Hold palette code until Design's direction is forwarded. When unblocked:

### Target

| Item | Value |
|------|--------|
| Branch | `cursor/site-revamp` (not `…-preview…`) |
| PR | **Draft** only; title/body must not include the word `preview` so Vercel does not deploy a preview |
| Base | `main` |
| Contents | #432 product/SEO UX + #422 home/dinner copy + approved visual-token revamp + any follow-up contrast fixes |
| Close | Supersede / close #432 and #422 once the combined draft exists (or leave open until the one PR lands; do not merge them separately) |

### Inputs to fold (pinned heads)

**1. PR #432** — `cursor/seo-no-limits-line` @ **`4f28719`**  
https://github.com/vaibhavarora14/sharedmoney-app/pull/432

Include:

- SEO hero **lead**: `No daily limits on expenses, no ads, no bank link.` on roommate + Splitwise pages
- `.route-hero-lead` (ink) + `.route-hero-body` (text-subtle) hierarchy
- Compact **primary CTA**: full width below 768px, auto/intrinsic width from 768px up; **iOS + web** as text links under the primary
- One-line Splitwise proof cards (uniform string proofs, including settle line)
- `page_path` on analytics event `seo cta clicked`
- Related PageHero / App wiring for secondary destinations; SEO SSR/build/test updates on that branch

**2. PR #422** — `cursor/web-copy-receipt-hero-cdae` @ **`78e71ea`**  
https://github.com/vaibhavarora14/sharedmoney-app/pull/422

Include (web only; skip version-bump noise unless required):

- Home `seo-content.json` `home.body`: `Record who paid and who owes for trips, rent and dinners. No daily limits, no ads.`
- Dinner scenario summary in `landingContent.ts`: `receipt` → `expense`, and drop the Oxford comma in that sentence

### Merge order (when building `cursor/site-revamp`)

1. Branch from latest `main`.
2. Bring in **#432** first (`4f28719`): larger surface (components, CSS, analytics, SEO content).
3. Bring in **#422** (`78e71ea`) web copy on top.
4. Resolve the only real content overlap: `web/src/seo-content.json`.
   - Keep #422 **home.body**.
   - Keep #432 **lead / proof / roommate + splitwise** fields and any schema additions.
   - Do not reintroduce title+body proof objects; #432 head intentionally flattened Splitwise proofs to one-liners.
5. Apply Design-approved tokens (palette, type, borders, section/card treatment) as the final layer. Re-check PR#432 body-on-gradient ratios after token changes (today: 5.60 / 6.06 on live stops; aim AAA muted if Design agrees).
6. Open **one draft** PR from `cursor/site-revamp`. No separate merges of #432/#422.

### Explicit non-goals until Design replies

- No new palette commits on `main` or on a ship branch beyond folding plan docs.
- No Vercel preview-oriented branch naming.
- Audit branch `cursor/site-revamp-audit` stays docs/artifacts only.

---

## Routes audited

| Path | Kind | Notes |
|------|------|-------|
| `/` | home | Hero, workflow, use cases, trust, FAQ, install, footer |
| `/roommate-expense-tracker` | SEO page | route-hero gradient |
| `/splitwise-alternative` | SEO page | route-hero gradient |
| `/split` | bill split start | Separate bill-split chrome |
| `/split-bills` | SEO page | |
| `/trip-expense-splitter` | SEO page | |
| `/group-expense-tracker` | SEO page | |
| `/tools` | tools directory | Cards |
| `/tools/split-bill-calculator` | tool | Calculator shell |

Also present in code: `/in/splitwise-alternative`, `/tools/settle-up-calculator`, `/split/:token`.

Dark mode is supported via `html.dark` / `ThemeContext` (system preference + session toggle).

---

## Findings table (WCAG failures and key measured pairs)

Thresholds: **4.5:1** normal text, **3:1** large text and UI components (borders, separators). Ratios rounded to 2 decimals.

| Status | Theme | Role | Selector / pair | Foreground | Background | Ratio | Need | Notes |
|--------|-------|------|-----------------|------------|------------|------:|-----:|-------|
| FAIL | light | UI border | `.hero-proof-strip` border/bg | `#d8e0ec` | `#ffffff` | 1.33 | 3.0 | Proof strip edges disappear |
| FAIL | light | UI border | `.site-footer` border/bg | `#d8e0ec` | `#ffffff` | 1.33 | 3.0 | Footer separator weak |
| FAIL | light | UI border | `.tool-directory-card` border/bg | `#d8e0ec` | `#ffffff` | 1.33 | 3.0 | Cards blend into canvas |
| FAIL | light | UI border | `--color-border` on canvas | `#d8e0ec` | `#f7f9fc` | 1.26 | 3.0 | Default hairline token |
| FAIL | light | UI border | `--color-border-strong` on white | `#b7c3d4` | `#ffffff` | 1.78 | 3.0 | Still under 3:1 |
| FAIL | dark | UI border | proof/footer/tool borders | `#34404e` | `#181f28` | 1.57 | 3.0 | Same failure in dark |
| FAIL | dark | UI border | `--color-border-strong` on surface | `#526173` | `#181f28` | 2.62 | 3.0 | |
| FAIL | light | text (kicker) | `#use-cases .kicker` | `#1f5eff` | `#eaf0ff` | 4.49 | 4.5 | axe: 4.48 serious |
| FAIL | light | text (tab) | `#use-case-tab-dinner.is-active` | `#1f5eff` | `#eaf0ff` | 4.49 | 4.5 | axe home light |
| FAIL | light | text (accent) | coral used as text on white | `#c95872` | `#ffffff` | 4.10 | 4.5 | Token risk for labels |
| PASS* | light | muted | muted on canvas | `#526074` | `#f7f9fc` | 6.06 | 4.5 | AA pass, not AAA |
| PASS | light | body | ink on canvas | `#17202a` | `#f7f9fc` | 15.60 | 4.5 | Strong |
| PASS | light | CTA | white on action | `#ffffff` | `#1f5eff` | 5.12 | 4.5 | AA only |
| PASS | light | install muted | install copy on ink plate | `#c3ccd7` | `#17202a` | 10.14 | 4.5 | Hard-coded inverse |
| WARN | light | hierarchy | surface vs canvas | `#ffffff` | `#f7f9fc` | 1.05 | n/a | Sections do not separate without borders |
| **PR#432** | light | SEO body | `.route-hero-body` vs **darkest** gradient stop (`--color-blue-wash`) | `#526074` `rgb(82,96,116)` | `#eaf0ff` | **5.60** | 4.5 | **PASS AA** (in-flight PR) |
| **PR#432** | light | SEO body | `.route-hero-body` vs **lightest** gradient stop (`--color-canvas`) | `#526074` | `#f7f9fc` | **6.06** | 4.5 | **PASS AA** |
| **PR#432** | dark | SEO body | subtle vs lightest stop (`--color-blue-wash`) | `#b9c4d3` | `#1b2b50` | **7.89** | 4.5 | PASS |
| **PR#432** | dark | SEO body | subtle vs darkest stop (`--color-canvas`) | `#b9c4d3` | `#10151c` | **10.38** | 4.5 | PASS |
| compare | light | SEO body today (main) | `.route-hero p` ink vs wash | `#17202a` | `#eaf0ff` | 14.42 | 4.5 | Current main before PR body demotion |

Gradient CSS (live + PR):  
`background: linear-gradient(135deg, var(--color-blue-wash), var(--color-canvas) 68%);`  
Light stops: wash `#eaf0ff` (darker), canvas `#f7f9fc` (lighter). Mid-blend samples stay between **5.60** and **6.06**.

### axe-core

Only **home / light** reported `color-contrast` violations (2 nodes: use-cases kicker, Dinner Groups tab). Other sampled routes returned no axe contrast violations at 390×844, which aligns with body text mostly passing while **border UI contrast is outside axe's typical text rule**.

---

## Weak hierarchy (visual, beyond ratios)

- Sticky header: 1px `#d8e0ec` on near-identical nav wash; header does not read as a bar.
- Home hero: trust pills and proof strip use the same faint border language; product shot sits on white plate but surrounding chrome does not frame it.
- SEO `.route-hero`: soft blue wash into canvas is pleasant but low drama; PR#432 muted body further softens the first viewport.
- Cards (use cases, SEO copy cards, tool directory): white on `#f7f9fc` with 1.33:1 borders = "floating text", not cards.
- Install band is the only high-contrast plate (`#17202a`); it proves the brand can punch, then the rest of the page returns to fog.

---

## Current design tokens (from `web/src/index.css`)

### Color (light / dark)

| Token | Light | Dark |
|-------|-------|------|
| `--color-canvas` | `#f7f9fc` | `#10151c` |
| `--color-surface` | `#ffffff` | `#181f28` |
| `--color-surface-alt` | `#eef2f7` | `#202934` |
| `--color-ink` / `--color-text` | `#17202a` | `#f4f7fb` |
| `--color-text-subtle` | `#526074` | `#b9c4d3` |
| `--color-border` | `#d8e0ec` | `#34404e` |
| `--color-border-strong` | `#b7c3d4` | `#526173` |
| `--color-action` | `#1f5eff` | `#7598ff` |
| `--color-action-hover` | `#164edb` | `#91adff` |
| `--color-action-text` | `#ffffff` | `#0c1422` |
| `--color-blue-wash` | `#eaf0ff` | `#1b2b50` |
| `--color-coral` | `#c95872` | `#e58aa2` |
| `--color-coral-deep` | `#a53855` | `#f3a8bb` |
| `--color-coral-wash` | `#f8e2e8` | `#3b202b` |
| `--color-green` | `#00866e` | `#68d6c2` |
| `--color-green-wash` | `#dff6ef` | `#173a34` |
| `--color-neutral-wash` | `#f2f4f7` | `#242d38` |
| `--color-nav-bg` | `rgba(247,249,252,0.94)` | `rgba(16,21,28,0.95)` |
| `--color-visited` | `#5c3ea8` | `#cab8ff` |

Aligned with mobile `mobile/theme.ts` Electric Pocket: ink `#17202A`, action `#1F5EFF`, berry `#C95872`, sea `#00866E`, canvas `#F7F9FC`.

### Type

- Font: `Instrument Sans Variable` (`--font-sans`)
- Weights in use: 560 / 620 / 650 / 680 / 700 / 720 (variable font)
- Key sizes: kicker 0.8125rem; body ~1–1.0625rem; hero lead 1.25rem; section H2 2.75rem; home H1 `clamp(3.25rem, 6vw, 5.25rem)`; SEO H1 `clamp(2.8rem, 5vw, 4.5rem)`
- Line height: body 1.5; headings ~1.08

### Space / radius / layout

- Space scale: 0.25 → 5.5rem (`--space-1` … `--space-11`), 4px base
- Radius: `--radius-1` 0.25rem, `--radius-2` 0.5rem (also `999px` pills)
- Content width: 73.75rem (1180px); header height 4rem

### Hard-coded colors that bypass tokens

| Location | Values | Why it matters |
|----------|--------|----------------|
| `.kicker-inverse` | `#a9bcff` | Not tokenized |
| `.skip-link` | `#fff` / `#17202a` | OK contrast, hard-coded |
| `.cta-inverse` | white plate / ink text | Install/inverse CTAs |
| `.hero-trust-row span` | `rgba(255,255,255,0.72)` | Light-only glass; dark overridden |
| `.hero-product-shot` | `#ffffff` plate | Forced light media well |
| `.install-section` | bg `#17202a`, text `#fff`, muted `#c3ccd7`, secondary CTA `#222c38` / `#3c4857` | Full inverse band outside tokens |
| Brand inverse SVG | `#ffffff` / `#17202a` fills | Mark mono/inverse |

---

## Proposed visual system

### Direction A (recommended): Sharper Pocket

Keep Electric Pocket metaphor (action blue, berry, sea, wallet mark). Fix the fog by deepening borders and muted ink, slightly darkening canvas, and choosing a brand blue that clears the wash.

| Role | Hex | Key ratios |
|------|-----|------------|
| Background (canvas) | `#EEF2F8` | |
| Surface | `#FFFFFF` | vs canvas **1.12:1** (clearer plate) |
| Surface alt | `#E2E8F2` | |
| Ink / primary text | `#0F1720` | vs canvas **16.06:1** (AAA) |
| Secondary text | `#243041` | vs canvas **11.87:1** |
| Muted | `#3A4960` | vs canvas **8.12:1** AAA; vs wash `#DCE6FF` **7.30:1**; vs white **9.12:1** |
| Brand / accent action | `#0B4DFF` | vs wash **4.77:1** AA; vs canvas **5.31:1**; white on brand **5.97:1** |
| Brand hover | `#0839C7` | |
| Brand wash | `#DCE6FF` | (replaces `#EAF0FF`) |
| Success | `#007A64` | vs white **5.29:1** |
| Warn | `#9A5B00` | vs white **5.43:1** |
| Berry accent (text-safe) | `#A83D57` | vs white **6.05:1** (deepen from `#C95872`) |
| Border | `#74859B` | vs white **3.77:1**; vs canvas **3.36:1** (UI AA) |
| Border strong | `#5A6B82` | ≥3:1 on surfaces |

**Type (keep Instrument Sans Variable):**

| Step | Size | Weight | Use |
|------|------|--------|-----|
| Display | `clamp(3.25rem, 6vw, 5.25rem)` | 720 | Home brand H1 |
| H1 SEO | `clamp(2.6rem, 5vw, 4rem)` | 720 | Route heroes |
| H2 | 2.25–2.5rem | 680 | Section titles |
| Lead | 1.25rem | 500–560 | Hero / SEO lead |
| Body | 1.0625rem | 400–500 | Default copy |
| Muted / meta | 0.9375rem | 500 | Nav, footer, secondary |
| Kicker | 0.8125rem | 720 | Uppercase labels |
| CTA | 1rem | 680 | Buttons |

**Section / card treatment:**

1. Canvas `#EEF2F8` as page ground; cards and proof strip on `#FFFFFF` with **`1px solid #74859B`** (or border-strong for primary cards).
2. Optional 1-step elevation: very soft shadow only when border alone is not enough (`0 12px 28px -20px rgba(15,23,32,0.35)`), not multi-layer glow.
3. SEO hero gradient: `#DCE6FF` → `#EEF2F8`. Body uses muted `#3A4960` (AAA on both stops) or secondary `#243041` if the lead already owns ink.
4. Header: border `#74859B` at 1px; nav links muted, hover to ink + surface-alt chip.
5. Install band can stay near `#0F1720` but should map to tokens (`--color-ink-inverse-bg`) instead of literals.

### Direction B (optional): Soft Ledger

Slightly softer brand blue `#1553F0`, muted `#445468`, border `#7F90A6` (3.26:1 on white), canvas `#F3F6FB`. Same structure rules. Prefer A if the goal is "finally readable edges"; prefer B if you want a smaller delta from live `#1F5EFF`.

### Dark mode (both directions)

Retarget borders to ≥3:1 on surface (today `#34404e` / `#181f28` = 1.57). Suggested border ~`#7B8B9E` class, keep action light enough for canvas (≥4.5) with dark action-text.

---

## Before / after mockups

Local-only HTML (not deployed):

- `mockups/home-hero-compare.html`
- `mockups/seo-hero-compare.html` (models PR#432 lead/body hierarchy on the gradient)

Screenshots:

| File | Viewport |
|------|----------|
| `screenshots/mock_home_hero_390x844.png` | 390×844 full compare |
| `screenshots/mock_home_hero_1440x900.png` | 1440×900 full compare |
| `screenshots/mock_home_hero_before_390x844.png` / `_after_` / `_1440x900` | Crops |
| `screenshots/mock_seo_hero_390x844.png` | 390×844 |
| `screenshots/mock_seo_hero_1440x900.png` | 1440×900 |
| `screenshots/mock_seo_hero_before_*` / `_after_*` | Crops |

Live site captures also under `screenshots/` (`home_*`, `roommate-expense-tracker_*`, `splitwise-alternative_*`, `split_*`, …) light/dark where sampled.

Raw data: `audit-raw.json`, `contrast-failures.json`, `pr432-gradient-contrast.json`, `axe/*.json`.

---

## Recommended next implementation step (not done here)

1. Lift border tokens to ≥3:1; deepen canvas one step.
2. Fix action/wash pair (deeper action and/or deeper wash) so kickers and tabs clear 4.5:1.
3. Deepen coral when used as text; keep washes for containers.
4. Tokenize install inverse band.
5. Re-check PR#432 body: current subtle **passes**; with Sharper Pocket muted it gains ~1.7:1 on the dark wash stop and clearer hierarchy vs lead.

---

## Artifact index

```
/opt/cursor/artifacts/site-revamp-audit/
  audit-report.md
  audit-raw.json
  contrast-failures.json
  pr432-gradient-contrast.json
  pr432-gradient-contrast-dark.json
  axe/
  screenshots/
  mockups/
```
