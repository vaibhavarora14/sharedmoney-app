# UI Plan: Pay via UPI (Design review)

Short plan for early Design review. SharedMoney never moves money; UPI opens the user's payment app (or shows a copyable VPA on desktop web). After returning, the user still taps **Record settlement**.

## Screens touched

1. **Edit Profile** (`ProfileSetupScreen`) — optional UPI ID field
2. **Settle / payment modal** (`SettlementFormScreen`) — Pay via UPI CTA, no-VPA hint, or desktop copy
3. Entry points unchanged: group settle row, People settlements line settle

## Profile field

- **Label:** UPI ID
- **Optional**
- **Placeholder:** `name@okhdfc`
- **Helper:** Group members can see this so they can pay you.
- **Validation error:** Enter a UPI ID like name@okhdfc.
- **Placement:** After Phone, before Appearance

## Settle modal (you owe / create only)

Order of CTAs when currency is **INR** and the payee has a UPI ID:

1. **Pay via UPI** (primary contained)
   - Native / mobile web: opens `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=SharedMoney: {group}`
   - Non-mobile web: show UPI ID + Copy (deep links usually fail on desktop); no QR unless a tiny existing dependency appears
2. **Record settlement** (existing ledger write; never auto-mark after UPI)
3. Cancel

When currency is **INR** and the payee has **no** UPI ID:

1. Record settlement (unchanged primary)
2. Quiet secondary hint (not a dead button): Ask {FirstName} to add a UPI ID
3. Cancel

When currency is **not INR**: no UPI button and no UPI hint.

Remind (they owe you) stays as today.

## Copy strings

| Surface | Copy |
| --- | --- |
| Profile label | UPI ID |
| Profile helper | Group members can see this so they can pay you. |
| Profile placeholder | name@okhdfc |
| Validation | Enter a UPI ID like name@okhdfc. |
| Primary CTA | Pay via UPI |
| Ledger CTA (existing) | Record settlement |
| No-VPA hint | Ask {name} to add a UPI ID |
| Desktop copy | Copy / Copied |
| Outside-app help (existing) | When someone pays outside the app, log it here. |

No "beta" and no em dashes in product copy.
