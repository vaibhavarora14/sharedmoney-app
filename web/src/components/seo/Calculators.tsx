import { useRef, useState, type FormEvent } from "react";
import { trackToolCompleted, trackToolStarted } from "../../analytics";
import { platformDestinations, type PlatformDestination } from "../../landingContent";
import type { SeoPage } from "../../seoPages";
import {
  calculateBillSplit,
  calculateSettlementPlan,
  type BillSplitParticipant,
  type SettlementParticipant,
} from "../../utils/calculators";
import { CURRENCY_CODES } from "../../utils/isoCurrencies";
import { PlatformCta } from "../landing/PlatformCta";
import { StoreBadges } from "../landing/StoreBadges";

const webDestination = platformDestinations.find((destination) => destination.platform === "web")!;

function CalculatorStoreCtas({
  primaryDestination,
  placement,
}: {
  primaryDestination: PlatformDestination;
  placement: string;
}) {
  return (
    <div className="calculator-store-ctas">
      <StoreBadges placement={placement} preferPlatform={primaryDestination.platform} />
      <PlatformCta destination={webDestination} placement={`${placement}_web`} appearance="text" />
    </div>
  );
}

const currencies = [...CURRENCY_CODES];

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function uniqueId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="calculator-field calculator-field-compact">
      <span>Currency</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
      </select>
    </label>
  );
}

function BillSplitCalculator({ primaryDestination }: { primaryDestination: PlatformDestination }) {
  const [subtotal, setSubtotal] = useState("");
  const [fees, setFees] = useState("0");
  const [tipPercent, setTipPercent] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [participants, setParticipants] = useState<BillSplitParticipant[]>([
    { id: "split-1", name: "Alex", weight: "1" },
    { id: "split-2", name: "Blair", weight: "1" },
  ]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateBillSplit> | null>(null);
  const hasTrackedStart = useRef(false);

  const trackStart = () => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackToolStarted("split_bill");
    }
  };

  const updateParticipant = (
    id: string,
    field: "name" | "weight",
    value: string,
  ) => {
    trackStart();
    setParticipants((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const addParticipant = () => {
    trackStart();
    setParticipants((items) => items.length >= 20 ? items : [
      ...items,
      { id: uniqueId("split"), name: `Person ${items.length + 1}`, weight: "1" },
    ]);
  };

  const removeParticipant = (id: string) => {
    trackStart();
    setParticipants((items) => items.length <= 2 ? items : items.filter((item) => item.id !== id));
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    trackStart();

    try {
      const nextResult = calculateBillSplit({ subtotal, fees, tipPercent, currency, participants });
      setResult(nextResult);
      setError("");
      trackToolCompleted("split_bill");
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Please check the values and try again.");
    }
  };

  return (
    <form className="calculator-card" onSubmit={calculate}>
      <div className="calculator-heading">
        <div>
          <p className="kicker">Bill details</p>
          <h2>Calculate each share</h2>
        </div>
        <CurrencySelect value={currency} onChange={(value) => { trackStart(); setCurrency(value); }} />
      </div>

      <div className="calculator-fields calculator-money-fields">
        <label className="calculator-field"><span>Subtotal</span><input inputMode="decimal" required placeholder="0.00" value={subtotal} onFocus={trackStart} onChange={(event) => setSubtotal(event.target.value)} /></label>
        <label className="calculator-field"><span>Fixed tax or fees</span><input inputMode="decimal" required placeholder="0.00" value={fees} onFocus={trackStart} onChange={(event) => setFees(event.target.value)} /></label>
        <label className="calculator-field"><span>Tip (%)</span><input inputMode="decimal" required placeholder="0" value={tipPercent} onFocus={trackStart} onChange={(event) => setTipPercent(event.target.value)} /></label>
      </div>

      <div className="calculator-participants">
        <div className="calculator-list-heading">
          <div><h3>People sharing the bill</h3><p>Use a weight of 1 for an equal split.</p></div>
          <button className="text-button" type="button" onClick={addParticipant} disabled={participants.length >= 20}>Add person</button>
        </div>
        {participants.map((participant, index) => (
          <div className="calculator-person-row" key={participant.id}>
            <label className="calculator-field"><span>Person {index + 1}</span><input required value={participant.name} onFocus={trackStart} onChange={(event) => updateParticipant(participant.id, "name", event.target.value)} /></label>
            <label className="calculator-field calculator-field-weight"><span>Weight</span><input inputMode="decimal" required value={participant.weight} onFocus={trackStart} onChange={(event) => updateParticipant(participant.id, "weight", event.target.value)} /></label>
            <button className="icon-text-button" type="button" onClick={() => removeParticipant(participant.id)} disabled={participants.length <= 2} aria-label={`Remove ${participant.name || `person ${index + 1}`}`}>Remove</button>
          </div>
        ))}
      </div>

      <button className="cta cta-primary calculator-submit" type="submit">Calculate split</button>
      {error ? <p className="calculator-error" role="alert">{error}</p> : null}
      {result ? (
        <output className="calculator-result" aria-live="polite">
          <p>Total bill <strong>{formatMoney(result.totalMinor, result.currency)}</strong></p>
          <ul>
            {result.shares.map((share) => <li key={share.id}><span>{share.name}</span><strong>{formatMoney(share.amountMinor, result.currency)}</strong></li>)}
          </ul>
          <p className="calculator-result-note">Need to track more than one bill? Start a shared ledger in SharedMoney.</p>
          <CalculatorStoreCtas primaryDestination={primaryDestination} placement="split_bill_result" />
        </output>
      ) : null}
    </form>
  );
}

function SettleUpCalculator({ primaryDestination }: { primaryDestination: PlatformDestination }) {
  const [currency, setCurrency] = useState("USD");
  const [participants, setParticipants] = useState<SettlementParticipant[]>([
    { id: "settle-1", name: "Alex", balance: "50" },
    { id: "settle-2", name: "Blair", balance: "-20" },
    { id: "settle-3", name: "Casey", balance: "-30" },
  ]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateSettlementPlan> | null>(null);
  const hasTrackedStart = useRef(false);

  const trackStart = () => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackToolStarted("settle_up");
    }
  };

  const updateParticipant = (
    id: string,
    field: "name" | "balance",
    value: string,
  ) => {
    trackStart();
    setParticipants((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const addParticipant = () => {
    trackStart();
    setParticipants((items) => items.length >= 20 ? items : [
      ...items,
      { id: uniqueId("settle"), name: `Person ${items.length + 1}`, balance: "0" },
    ]);
  };

  const removeParticipant = (id: string) => {
    trackStart();
    setParticipants((items) => items.length <= 2 ? items : items.filter((item) => item.id !== id));
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    trackStart();

    try {
      const nextResult = calculateSettlementPlan({ currency, participants });
      setResult(nextResult);
      setError("");
      trackToolCompleted("settle_up");
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Please check the balances and try again.");
    }
  };

  return (
    <form className="calculator-card" onSubmit={calculate}>
      <div className="calculator-heading">
        <div>
          <p className="kicker">Net balances</p>
          <h2>Make a simple repayment plan</h2>
        </div>
        <CurrencySelect value={currency} onChange={(value) => { trackStart(); setCurrency(value); }} />
      </div>
      <p className="calculator-helper">Positive means a person should receive money. Negative means they should pay. The example balances below add up to zero—replace them with your group’s balances.</p>

      <div className="calculator-participants">
        <div className="calculator-list-heading">
          <div><h3>Group balances</h3><p>Use one currency at a time.</p></div>
          <button className="text-button" type="button" onClick={addParticipant} disabled={participants.length >= 20}>Add person</button>
        </div>
        {participants.map((participant, index) => (
          <div className="calculator-person-row" key={participant.id}>
            <label className="calculator-field"><span>Person {index + 1}</span><input required value={participant.name} onFocus={trackStart} onChange={(event) => updateParticipant(participant.id, "name", event.target.value)} /></label>
            <label className="calculator-field calculator-field-weight"><span>Net balance</span><input inputMode="decimal" required value={participant.balance} onFocus={trackStart} onChange={(event) => updateParticipant(participant.id, "balance", event.target.value)} /></label>
            <button className="icon-text-button" type="button" onClick={() => removeParticipant(participant.id)} disabled={participants.length <= 2} aria-label={`Remove ${participant.name || `person ${index + 1}`}`}>Remove</button>
          </div>
        ))}
      </div>

      <button className="cta cta-primary calculator-submit" type="submit">Create repayment plan</button>
      {error ? <p className="calculator-error" role="alert">{error}</p> : null}
      {result ? (
        <output className="calculator-result" aria-live="polite">
          <p>Suggested payments</p>
          <ul>
            {result.transfers.length === 0 ? <li><span>Everyone is already settled.</span></li> : result.transfers.map((transfer, index) => <li key={`${transfer.from}-${transfer.to}-${index}`}><span><strong>{transfer.from}</strong> pays <strong>{transfer.to}</strong></span><strong>{formatMoney(transfer.amountMinor, result.currency)}</strong></li>)}
          </ul>
          <p className="calculator-result-note">This is a clear, greedy repayment plan—not a claim that it uses the fewest possible payments.</p>
          <CalculatorStoreCtas primaryDestination={primaryDestination} placement="settle_up_result" />
        </output>
      ) : null}
    </form>
  );
}

export function Calculator({
  page,
  primaryDestination,
}: {
  page: SeoPage;
  primaryDestination: PlatformDestination;
}) {
  if (page.tool === "split_bill") {
    return <BillSplitCalculator primaryDestination={primaryDestination} />;
  }

  return <SettleUpCalculator primaryDestination={primaryDestination} />;
}
