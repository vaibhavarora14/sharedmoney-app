import { useState } from "react";
import { askForNewLinkLabel, RESEND_REQUEST_TEXT } from "./billLinkCopy";

/**
 * Dead bill link. Often a new visitor's first screen, so: say what likely
 * happened, say nothing was paid, and offer a way forward.
 */
export function BillLinkUnavailable({ friendName }: { friendName?: string | null }) {
  const [notice, setNotice] = useState("");
  const ask = async () => {
    try {
      if (navigator.share) { await navigator.share({ text: RESEND_REQUEST_TEXT }); return; }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(RESEND_REQUEST_TEXT);
        setNotice("Message copied. Paste it to the person who sent you the link.");
        return;
      }
      setNotice(`Send this to the person who shared the link: “${RESEND_REQUEST_TEXT}”`);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setNotice(`Send this to the person who shared the link: “${RESEND_REQUEST_TEXT}”`);
    }
  };
  return <div className="bill-split-unavailable" data-testid="bill-link-unavailable">
    <h2>This bill link isn’t working</h2>
    <p>It may have expired or been deleted by the person who shared it. Links last 30 days. SharedMoney never moves money, so nothing has been paid.</p>
    <div className="bill-split-actions">
      <button type="button" className="cta cta-primary" onClick={() => void ask()}>{askForNewLinkLabel(friendName)}</button>
      <a className="cta cta-secondary" href="/tools/split-bill-calculator">Split your own bill</a>
    </div>
    <p role="status">{notice}</p>
    <p className="bill-split-note">
      <a href="/">Go to SharedMoney</a> · New here? <a href="/app">Create a free account</a> to track shared expenses with friends.
    </p>
  </div>;
}
