const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function loadRecent() {
  const store = new Map();
  const filename = path.join(__dirname, "../utils/recentBillSplits.ts");
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (id === "@react-native-async-storage/async-storage") {
      const storage = {
        getItem: async (key) => (store.has(key) ? store.get(key) : null),
        setItem: async (key, value) => { store.set(key, value); },
      };
      storage.default = storage;
      return storage;
    }
    if (id === "./billSplit" || id.endsWith("/billSplit")) {
      return {
        BILL_TOKEN_PATTERN: /^[a-f0-9]{64}$/,
      };
    }
    if (id === "./currency" || id.endsWith("/currency")) {
      return {
        formatCurrency: (amount, currency) => {
          const symbol = currency === "EUR" ? "€" : currency === "INR" ? "₹" : "$";
          return `${symbol}${Number(amount).toFixed(2)}`;
        },
      };
    }
    return require(id);
  }, module, module.exports);
  return { ...module.exports, store };
}

test("recent bill identity prefers name, then With <person> fallbacks", () => {
  const { recentBillIdentity } = loadRecent();
  assert.equal(recentBillIdentity({ name: "Dinner" }), "Dinner");
  assert.equal(recentBillIdentity({ firstPayeeName: "Maya Patel" }), "With Maya Patel");
  assert.equal(recentBillIdentity({ creatorName: "Alex" }), "With Alex");
  assert.equal(recentBillIdentity({}), "Bill");
});

test("formatRecentBillAmount uses symbol currency formatting", () => {
  const { formatRecentBillAmount } = loadRecent();
  assert.equal(formatRecentBillAmount(1250, "USD"), "$12.50");
  assert.equal(formatRecentBillAmount(120000, "INR"), "₹1200.00");
});

test("relativeBillDate covers Today and Nd ago", () => {
  const { relativeBillDate } = loadRecent();
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  assert.equal(relativeBillDate("2026-10-20T08:00:00.000Z", now), "Today");
  assert.equal(relativeBillDate("2026-10-18T08:00:00.000Z", now), "2d ago");
});

test("rememberRecentBillSplit keeps newest history and last-used currency", async () => {
  const {
    rememberRecentBillSplit,
    listRecentBillSplits,
    readLastBillSplitCurrency,
    RECENT_BILLS_PREVIEW_COUNT,
  } = loadRecent();
  assert.equal(RECENT_BILLS_PREVIEW_COUNT, 3);
  const tokenA = "a".repeat(64);
  const tokenB = "b".repeat(64);
  const tokenC = "c".repeat(64);
  const tokenD = "d".repeat(64);
  await rememberRecentBillSplit("user-1", {
    token: tokenA, amount_minor: 1000, currency: "USD", mode: "equal", people_count: 2, name: "A",
  });
  await rememberRecentBillSplit("user-1", {
    token: tokenB, amount_minor: 2000, currency: "USD", mode: "shares", people_count: 3, firstPayeeName: "Bo",
  });
  await rememberRecentBillSplit("user-1", {
    token: tokenC, amount_minor: 3000, currency: "EUR", mode: "unequal", people_count: 2, creatorName: "Alex",
  });
  await rememberRecentBillSplit("user-1", {
    token: tokenD, amount_minor: 4000, currency: "USD", mode: "equal", people_count: 4, name: "Cabin",
  });
  const rows = await listRecentBillSplits("user-1");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.token), [tokenD, tokenC, tokenB, tokenA]);
  assert.equal(rows[0].identity, "Cabin");
  assert.equal(rows[0].people_count, 4);
  assert.equal(await readLastBillSplitCurrency(), "USD");
});

test("creatorNetMinor is total minus equal share", () => {
  const { creatorNetMinor } = loadRecent();
  assert.equal(creatorNetMinor(1000, 2), 500);
  assert.equal(creatorNetMinor(1000, 3), 1000 - Math.floor(1000 / 3));
});

test("summarizeUnsettledOneTimeBills hides settled and zero nets", () => {
  const { summarizeUnsettledOneTimeBills } = loadRecent();
  assert.equal(summarizeUnsettledOneTimeBills([]), null);
  assert.equal(
    summarizeUnsettledOneTimeBills([
      {
        token: "a".repeat(64),
        amount_minor: 1000,
        currency: "USD",
        mode: "equal",
        identity: "A",
        people_count: 2,
        remembered_at: "2026-10-20T00:00:00.000Z",
        settled: true,
        your_net_minor: 0,
      },
    ]),
    null,
  );
  const summary = summarizeUnsettledOneTimeBills([
    {
      token: "a".repeat(64),
      amount_minor: 4200,
      currency: "USD",
      mode: "equal",
      identity: "Dinner",
      people_count: 2,
      remembered_at: "2026-10-20T00:00:00.000Z",
      settled: false,
      your_net_minor: 2100,
    },
    {
      token: "b".repeat(64),
      amount_minor: 1425,
      currency: "EUR",
      mode: "equal",
      identity: "Taxi",
      people_count: 2,
      remembered_at: "2026-10-19T00:00:00.000Z",
      settled: false,
      your_net_minor: -1425,
    },
  ]);
  assert.ok(summary);
  assert.equal(summary.currency, "USD");
  assert.equal(summary.net_minor, 2100);
  assert.equal(summary.unsettled_count, 2);
});

test("rememberRecentBillSplit defaults settled false and creator net", async () => {
  const { rememberRecentBillSplit, listRecentBillSplits } = loadRecent();
  const token = "e".repeat(64);
  await rememberRecentBillSplit("user-2", {
    token,
    amount_minor: 3000,
    currency: "USD",
    mode: "equal",
    people_count: 3,
    name: "Brunch",
  });
  const rows = await listRecentBillSplits("user-2");
  assert.equal(rows[0].settled, false);
  assert.equal(rows[0].your_net_minor, 3000 - Math.floor(3000 / 3));
});

test("updateRecentBillSettlement patches without reordering", async () => {
  const {
    rememberRecentBillSplit,
    updateRecentBillSettlement,
    listRecentBillSplits,
  } = loadRecent();
  const tokenA = "f".repeat(64);
  const tokenB = "0".repeat(64);
  await rememberRecentBillSplit("user-3", {
    token: tokenA, amount_minor: 1000, currency: "USD", mode: "equal", people_count: 2, name: "A",
  });
  await rememberRecentBillSplit("user-3", {
    token: tokenB, amount_minor: 2000, currency: "USD", mode: "equal", people_count: 2, name: "B",
  });
  await updateRecentBillSettlement("user-3", tokenA, { settled: true, your_net_minor: 0 });
  const rows = await listRecentBillSplits("user-3");
  assert.deepEqual(rows.map((row) => row.token), [tokenB, tokenA]);
  assert.equal(rows[1].settled, true);
  assert.equal(rows[1].your_net_minor, 0);
});

test("settlementFromBillSession marks all-confirmed as settled", () => {
  const { settlementFromBillSession } = loadRecent();
  const settled = settlementFromBillSession({
    amount_minor: 3000,
    currency: "USD",
    mode: "equal",
    participants: [
      { id: "c", display_name: "You", amount_minor: 1000, confirmed: true },
      { id: "p", display_name: "Pat", amount_minor: 1000, confirmed: true },
      { id: "q", display_name: "Quinn", amount_minor: 1000, confirmed: true },
    ],
  });
  assert.deepEqual(settled, { settled: true, your_net_minor: 0 });
  const open = settlementFromBillSession({
    amount_minor: 3000,
    currency: "USD",
    mode: "equal",
    participants: [
      { id: "c", display_name: "You", amount_minor: 1000, confirmed: false },
      { id: "p", display_name: "Pat", amount_minor: 1000, confirmed: false },
      { id: "q", display_name: "Quinn", amount_minor: 1000, confirmed: false },
    ],
  });
  assert.equal(open.settled, false);
  assert.equal(open.your_net_minor, 2000);
});
