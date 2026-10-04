import { useEffect, useRef, useState } from "react";
import { allocateBillSplit, billAmountMinor, formatBillAmount, type BillSplitMode } from "../../../shared/billSplit";
import { createGuestBillSplit } from "../billSplitApi";
import "./BillSplitPage.css";

export function BillSplitStartPage() {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [mode, setMode] = useState<BillSplitMode>("equal");
  const [people, setPeople] = useState([{ id: 0, name: "", value: "" }, { id: 1, name: "", value: "" }]);
  const nextId = useRef(2);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { document.title = "Split a bill · SharedMoney"; }, []);

  const total = billAmountMinor(amount);
  const values = people.map((person) => mode === "unequal" ? billAmountMinor(person.value) ?? 0 : Number(person.value));
  let allocations: number[] = [];
  let validation = "";
  try { allocations = allocateBillSplit(total ?? 0, people.length, mode, values); }
  catch (err) { validation = (err as Error).message; }

  const changePerson = (id: number, field: "name" | "value", value: string) => {
    setPeople((current) => current.map((person) => person.id === id ? { ...person, [field]: value } : person));
  };
  const changeMode = (nextMode: BillSplitMode) => {
    setMode(nextMode);
    setPeople((current) => current.map((person) => ({ ...person, value: nextMode === "shares" ? "1" : "" })));
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (validation) { setError(validation); return; }
    if (people.some((person) => !person.name.trim())) { setError("Enter a name for each person, including yourself."); return; }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const token = await createGuestBillSplit({ amount: total!, currency, mode, values, people: people.map((person) => person.name.trim()) });
      // Stay on this origin, including localhost. Never redirect local bills to production.
      window.location.assign(`/split/${token}`);
    } catch (err) {
      setError((err as Error).message);
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <main className="bill-split-page" id="main-content">
    <section className="bill-split-card" aria-labelledby="bill-title">
      <a className="bill-split-brand" href="/" aria-label="SharedMoney home">SharedMoney</a>
      <h1 id="bill-title">Split a bill</h1>
      <p>One bill, one link. No group, account, or app needed.</p>
      <form className="bill-split-form" onSubmit={(event) => void create(event)}>
        <fieldset disabled={busy}>
          <legend>Bill details</legend>
          <div className="bill-split-fields">
            <label>Total amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
            <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {["USD", "INR", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"].map((code) => <option key={code}>{code}</option>)}
            </select></label>
          </div>
          <label>Split mode<select value={mode} onChange={(event) => changeMode(event.target.value as BillSplitMode)}>
            <option value="equal">Equal</option><option value="shares">Shares</option><option value="unequal">Exact amounts</option>
          </select></label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>People</legend>
          <p>Include yourself and everyone sharing the bill.</p>
          <ol className="bill-split-editor-people">
            {people.map((person, index) => <li key={person.id}>
              <label>{index === 0 ? "Your name" : `Person ${index + 1}`}<input value={person.name} maxLength={100} required onChange={(event) => changePerson(person.id, "name", event.target.value)} /></label>
              {mode !== "equal" ? <label>{mode === "shares" ? "Shares" : `Amount (${currency})`}<input
                aria-label={`${mode === "shares" ? "Shares" : "Amount"} for person ${index + 1}`}
                inputMode={mode === "shares" ? "numeric" : "decimal"} value={person.value} required
                onChange={(event) => changePerson(person.id, "value", event.target.value)} /></label> : null}
              {allocations.length ? <span>{formatBillAmount(allocations[index], currency)}</span> : null}
              {index > 0 && people.length > 2 ? <button type="button" className="text-button" aria-label={`Remove person ${index + 1}`} onClick={() => setPeople((current) => current.filter((p) => p.id !== person.id))}>Remove</button> : null}
            </li>)}
          </ol>
          <button type="button" className="text-button" disabled={people.length >= 50} onClick={() => setPeople([...people, { id: nextId.current++, name: "", value: mode === "shares" ? "1" : "" }])}>Add person</button>
        </fieldset>
        {amount && validation ? <p role="status">{validation}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <p className="bill-split-note">Anyone with the link can see the bill and acknowledge a share. Confirming does not move money. Links expire after 30 days.</p>
        <button className="cta cta-primary" type="submit" disabled={busy}>{busy ? "Creating bill…" : "Create split"}</button>
      </form>
    </section>
  </main>;
}
