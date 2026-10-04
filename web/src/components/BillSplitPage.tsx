import { useCallback, useEffect, useRef, useState } from "react";
import { formatBillAmount, type BillSplitSession } from "../../../mobile/utils/billSplit";
import { requestBillSplit } from "../billSplitApi";
import "./BillSplitPage.css";

export function BillSplitPage({ token }: { token: string | null }) {
  const [session, setSession] = useState<BillSplitSession | null>(null);
  const [loading, setLoading] = useState(!!token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const generation = useRef(0);
  const cancelPendingReads = useCallback(() => { generation.current++; }, []);

  const refresh = useCallback(async () => {
    if (!token || inFlight.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await requestBillSplit(token);
      if (request === generation.current) setSession(data);
    } catch (err) {
      if (request === generation.current) setError((err as Error).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    document.title = "Split a bill · SharedMoney";
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelPendingReads(); window.removeEventListener("focus", onFocus); };
  }, [refresh, cancelPendingReads]);

  const confirm = async (id: string) => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    cancelPendingReads();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await requestBillSplit(token, id);
      setSession(data);
      if (data) setNotice("Your share is confirmed. No money has moved.");
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(false); setLoading(false); }
  };

  return <main className="bill-split-page" id="main-content">
    <section className="bill-split-card" aria-labelledby="bill-title">
      <a className="bill-split-brand" href="/" aria-label="SharedMoney home">SharedMoney</a>
      <h1 id="bill-title">Split a bill</h1>
      {loading && !session ? <p role="status">Loading bill…</p> : null}
      {error ? <div role="alert"><p>{error}</p><button className="text-button" onClick={() => void refresh()} disabled={busy}>Try again</button></div> : null}
      {!loading && !error && !session ? <><h2>Bill not found</h2><p>This link is invalid or has expired.</p></> : null}
      {session ? <>
        <p className="kicker">{session.mode === "unequal" ? "Exact amounts" : session.mode === "shares" ? "Split by shares" : "Equal split"}</p>
        <p className="bill-split-total"><span>Total</span><strong>{formatBillAmount(session.amount_minor, session.currency)}</strong></p>
        <p>Find your name and confirm your share. No account or app needed.</p>
        <ul className="bill-split-people">
          {session.participants.map((person) => <li key={person.id}>
            <div><strong>{person.display_name}</strong><span>{formatBillAmount(person.amount_minor, session.currency)}</span></div>
            <button className="cta cta-primary" data-testid="split-bill-confirm"
              disabled={busy || loading || person.confirmed}
              aria-label={person.confirmed ? `${person.display_name}, confirmed` : `Confirm my share as ${person.display_name}`}
              onClick={() => void confirm(person.id)}>{person.confirmed ? "Confirmed" : "I’ll cover my share"}</button>
          </li>)}
        </ul>
        <p role="status">{notice}</p>
        <label className="bill-split-share">Share this bill
          <input aria-label="Bill share link" readOnly value={`${window.location.origin}/split/${token}`} onFocus={(event) => event.target.select()} />
        </label>
        <button className="text-button" onClick={() => {
          void (navigator.clipboard?.writeText(`${window.location.origin}/split/${token}`) ?? Promise.reject(new Error("Clipboard unavailable")))
            .then(() => setNotice("Link copied."))
            .catch(() => setNotice("Select and copy the link above to share this bill."));
        }}>Copy link</button>
        <p className="bill-split-note">Confirmation is an acknowledgement only. SharedMoney does not move money. Anyone with this link can see the bill and acknowledge a share. The link expires 30 days after creation.</p>
        <button className="text-button" disabled={busy || loading} onClick={() => void refresh()}>Refresh confirmations</button>
      </> : null}
    </section>
  </main>;
}
