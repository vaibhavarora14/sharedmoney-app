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
        formatBillAmount: (minor, currency) => `${currency} ${(minor / 100).toFixed(2)}`,
      };
    }
    return require(id);
  }, module, module.exports);
  return { ...module.exports, store };
}

test("recent bill titles keep amount + people for Home reopen rows", () => {
  const { recentBillTitle } = loadRecent();
  assert.equal(recentBillTitle(1250, "USD"), "USD 12.50");
  assert.equal(recentBillTitle(1250, "USD", 3), "USD 12.50 · 3 people");
});

test("rememberRecentBillSplit keeps the newest 3 and reopens by token", async () => {
  const { rememberRecentBillSplit, listRecentBillSplits } = loadRecent();
  const tokenA = "a".repeat(64);
  const tokenB = "b".repeat(64);
  const tokenC = "c".repeat(64);
  const tokenD = "d".repeat(64);
  await rememberRecentBillSplit("user-1", {
    token: tokenA, amount_minor: 1000, currency: "USD", mode: "equal", people_count: 2,
  });
  await rememberRecentBillSplit("user-1", {
    token: tokenB, amount_minor: 2000, currency: "USD", mode: "shares", people_count: 3,
  });
  await rememberRecentBillSplit("user-1", {
    token: tokenC, amount_minor: 3000, currency: "EUR", mode: "unequal", people_count: 2,
  });
  await rememberRecentBillSplit("user-1", {
    token: tokenD, amount_minor: 4000, currency: "USD", mode: "equal", people_count: 4,
  });
  const rows = await listRecentBillSplits("user-1");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.token), [tokenD, tokenC, tokenB]);
  assert.equal(rows[0].title, "USD 40.00 · 4 people");
});
