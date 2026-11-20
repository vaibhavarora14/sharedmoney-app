import { useEffect, useState } from "react";
import "./BillSplitPage.css";
import {
  formatYouOweAmount,
  requestPublicYouOwe,
  youOweHeadline,
  type PublicYouOweView,
} from "../youOweApi";

function Unavailable() {
  return (
    <div className="bill-split-unavailable" data-testid="you-owe-unavailable">
      <h1>This link isn’t available</h1>
      <p>It may have expired, been revoked, or not be in use. Nothing here shows a name or other personal details.</p>
      <p className="bill-split-note">
        <a href="/">Go to SharedMoney</a> · <a href="/app">Open the app</a>
      </p>
    </div>
  );
}

export function YouOwePage({ token }: { token: string | null }) {
  const [view, setView] = useState<PublicYouOweView | null | undefined>(token ? undefined : null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.title = "Balance · SharedMoney";
    if (!token) return;
    let cancelled = false;
    void requestPublicYouOwe(token)
      .then((next) => { if (!cancelled) setView(next); })
      .catch(() => { if (!cancelled) setView(null); });
    return () => { cancelled = true; };
  }, [token]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Amount copied.");
    } catch {
      setNotice("Copy the amount shown above.");
    }
  };

  return (
    <div className="bill-split-page">
      <div className="bill-split-card">
        <a className="bill-split-brand" href="/">SharedMoney</a>
        {view === undefined ? (
          <p data-testid="you-owe-loading">Loading this balance…</p>
        ) : view == null ? (
          <Unavailable />
        ) : (
          <div data-testid="you-owe-balance">
            <h1>{youOweHeadline(view)}</h1>
            {view.amounts.length > 1 ? (
              <ul className="bill-split-people">
                {view.amounts.map((line) => (
                  <li key={line.currency}>
                    <div>
                      <strong>{line.direction === "you_owe" ? "You owe" : "You're owed"}</strong>
                      <span>{formatYouOweAmount(line)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="bill-split-actions">
              {view.amounts[0] ? (
                <button
                  type="button"
                  className="cta cta-primary"
                  onClick={() => void copy(view.amounts.map((line) => formatYouOweAmount(line)).join(", "))}
                >
                  Copy amount
                </button>
              ) : null}
              <a className="cta cta-secondary" href="/app">Settle in SharedMoney</a>
            </div>
            <p role="status">{notice}</p>
            <p className="bill-split-note">
              This page only shows the open balance. It never includes names, emails, or other personal details.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
