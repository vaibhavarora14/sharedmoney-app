# UI Plan: Pay via UPI (Design review)

SharedMoney never moves money. UPI opens the user's payment app (or shows VPA + QR + Copy on desktop web). After returning, the modal asks whether to record. It never auto-records.

## Screens touched

1. **Edit Profile** (`ProfileSetupScreen`) — optional UPI ID field
2. **Settle / payment modal** (`SettlementFormScreen`) — Pay via UPI, iOS app picker, return confirm, desktop QR
3. Entry points unchanged: group settle row, People settlements line settle

## Profile field

- **Label:** UPI ID (optional)
- **No example placeholder**
- **Helper:** Group members can see this.
- **Inline validation:** Use name@handle.
- **Placement:** After Phone, before Appearance

## Settle modal (you owe / create only)

**INR + payee has UPI ID (before launch)**

1. Amount stays editable (partial payments OK; defaults to full balance)
2. Small line under amount: `To {name} · {upi_id}`
3. **Pay via UPI** is the only primary
   - iOS: installed-app picker (GPay, PhonePe, Paytm, BHIM); if none, Copy UPI ID
   - Android / mobile web: `upi://pay?…`
   - Desktop web: QR (160px+) + UPI ID + Copy
4. Quiet secondary: Record settlement
5. Cancel

**After returning from a UPI app**

- Modal swaps to one question: `Did you pay {name} ₹{amount}?`
- Primary: Yes, record it
- Quiet: Not yet
- Never auto-record

**INR + payee has no UPI ID**

1. Record settlement only (no Ask-to-add hint)

**Non-INR:** UPI UI stays hidden.

Remind (they owe you) unchanged.

## Copy strings

| Surface | Copy |
| --- | --- |
| Profile helper | Group members can see this. |
| Validation | Use name@handle. |
| Payee line | To {name} · {upi_id} |
| Primary CTA | Pay via UPI |
| Quiet ledger | Record settlement |
| Confirm | Did you pay {name} ₹{amount}? |
| Confirm primary | Yes, record it |
| Confirm secondary | Not yet |
| UPI note (`tn`) | SharedMoney · {group} (about 50 chars) |

No "beta" and no em dashes in product copy.
