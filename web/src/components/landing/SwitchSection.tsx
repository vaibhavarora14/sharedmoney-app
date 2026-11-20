import { Ban, FileUp, Infinity as InfinityIcon } from "lucide-react";

export const switchFromSplitwiseCtaHref =
  "/app?utm_source=organic&utm_medium=landing&utm_campaign=splitwise_switch";

export function SwitchSection() {
  return (
    <section
      id="switching-from-splitwise"
      className="section switch-section section-band"
      aria-labelledby="switch-title"
    >
      <div className="container">
        <div className="section-head section-head-wide">
          <p className="kicker">Switching from Splitwise</p>
          <h2 id="switch-title">No daily limits. No ads. Bring your groups with you.</h2>
          <p>
            SharedMoney has no daily expense cap and no ads. Import a Splitwise CSV into a
            group, then keep settling with cash, UPI, or bank transfer outside the app.
          </p>
        </div>

        <div className="trust-boundaries">
          <article>
            <InfinityIcon size={24} aria-hidden />
            <h3>Unlimited expenses</h3>
            <ul>
              <li>Add as many expenses as the group needs</li>
              <li>No daily cap on new entries</li>
            </ul>
          </article>
          <article>
            <Ban size={24} aria-hidden />
            <h3>No ads</h3>
            <ul>
              <li>The shared ledger stays uncluttered</li>
              <li>No advertising in the app or on the web app</li>
            </ul>
          </article>
          <article>
            <FileUp size={24} aria-hidden />
            <h3>Import your groups</h3>
            <ul>
              <li>Export a CSV from Splitwise</li>
              <li>Open a SharedMoney group and choose Import from Splitwise</li>
            </ul>
          </article>
        </div>

        <div className="switch-howto">
          <h3>How to bring a Splitwise group across</h3>
          <ol>
            <li>In Splitwise, export the group as a CSV.</li>
            <li>In SharedMoney, create or open the group you want to keep using.</li>
            <li>Open the group menu and choose Import from Splitwise, then review the mapping with the group.</li>
          </ol>
        </div>

        <p className="switch-actions">
          <a className="cta cta-primary" href={switchFromSplitwiseCtaHref}>
            Open SharedMoney to import
          </a>
          <a href="/splitwise-alternative">Read the Splitwise alternative guide</a>
        </p>
      </div>
    </section>
  );
}
