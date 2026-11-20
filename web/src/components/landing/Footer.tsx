import { BrandLockup } from "./BrandMark";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <a className="footer-brand" href="/" aria-label="Back to SharedMoney home">
          <BrandLockup />
        </a>
        <nav className="footer-links" aria-label="Support and legal">
          <a href="/split-bills">Split bills</a>
          <a href="/flatmate-expense-tracker">Flatmate expenses</a>
          <a href="/splitwise-alternative">Splitwise alternative</a>
          <a href="/in/splitwise-alternative">Splitwise alternative in India</a>
          <a href="/tools">Calculators</a>
          <a href="/faq">FAQ</a>
          <a href="mailto:support@sharedmoney.app">Contact support</a>
          <a href="/privacy">Privacy</a>
          <a href="/delete-account">Delete account</a>
        </nav>
        <p>{`© ${new Date().getFullYear()} SharedMoney. All rights reserved.`}</p>
      </div>
    </footer>
  );
}
