import { CreditCard, Database, ExternalLink, LockKeyhole } from "lucide-react";

export function TrustSection() {
  return (
    <section id="trust" className="section trust-section section-band" aria-labelledby="trust-title">
      <div className="container">
        <div className="section-head section-head-wide">
          <p className="kicker">A ledger, not a wallet</p>
          <h2 id="trust-title">No bank link. No payment handling.</h2>
        </div>

        <div className="trust-boundaries">
          <article>
            <Database size={24} aria-hidden />
            <h3>Stores the record</h3>
            <ul>
              <li>Groups and members</li>
              <li>Expenses, balances, notes, and activity</li>
              <li>Currency and split details</li>
            </ul>
          </article>
          <article>
            <CreditCard size={24} aria-hidden />
            <h3>Skips bank access</h3>
            <ul>
              <li>Your bank login</li>
              <li>Card or payment instrument details</li>
              <li>Permission to move your money</li>
            </ul>
          </article>
          <article>
            <ExternalLink size={24} aria-hidden />
            <h3>Payments stay outside</h3>
            <ul>
              <li>Use your preferred payment app</li>
              <li>Return to record the settlement</li>
              <li>Keep the group history complete</li>
            </ul>
          </article>
        </div>

        <p className="trust-encryption">
          <LockKeyhole size={18} aria-hidden />
          Data is encrypted in transit and at rest where platform support applies.
        </p>
      </div>
    </section>
  );
}
