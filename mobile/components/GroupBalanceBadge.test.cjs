const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

function loadBadge(theme = { dark: false, colors: {} }) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (id) => {
      if (id === "./Skeleton") return { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" };
      if (id === "react") return { ...React, useMemo: (fn) => fn() };
      if (id === "react-native") {
        return {
          View: "View",
          StyleSheet: { create: (styles) => styles },
        };
      }
      if (id === "react-native-paper") {
        return { Text: "Text", useTheme: () => theme };
      }
      if (id === "../hooks/useCurrencyPreferences") {
        return { useCurrencyPreferences: () => ({ groupSettings: null, rateBook: {} }) };
      }
      if (id.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filename), id);
        return load(existsSync(resolved) ? resolved : `${resolved}.ts`);
      }
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }
  return load(path.join(__dirname, "GroupBalanceBadge.tsx")).GroupBalanceBadge;
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.Children.toArray(tree?.props?.children).map(text).join("");
}

const lightTheme = {
  dark: false,
  colors: {
    onSurfaceVariant: "#5B6776",
    onTertiaryContainer: "#075E51",
    onSecondaryContainer: "#842A43",
    secondary: "#C95872",
  },
};

test("group list zero balance shows Even, never Settled", () => {
  const Badge = loadBadge(lightTheme);
  for (const balanceData of [null, { group_id: "g", balances: [] }, { group_id: "g", balances: [{ user_id: "me", amount: 0, currency: "USD" }] }]) {
    const tree = Badge({ balanceData, currentUserId: "me", loading: false });
    assert.match(text(tree), /Even/);
    assert.doesNotMatch(text(tree), /Settled/i);
    assert.equal(nodes(tree).some((n) => n.props?.testID === "group-balance-even"), true);
  }
});

test("group list does not claim Even while balances are still loading", () => {
  const Badge = loadBadge(lightTheme);
  for (const balanceData of [undefined, null, { group_id: "g", balances: [] }]) {
    const tree = Badge({ balanceData, currentUserId: "me", loading: true });
    assert.doesNotMatch(text(tree), /Even|Settled/i);
    assert.equal(nodes(tree).some((n) => n.props?.testID === "group-balance-loading"), true);
    assert.equal(nodes(tree).some((n) => n.props?.testID === "group-balance-even"), false);
  }
});

test("group list non-zero balance uses owed/owe words without Settled or bare +/-", () => {
  const Badge = loadBadge(lightTheme);
  const owed = Badge({
    balanceData: {
      group_id: "g",
      balances: [{ user_id: "me", amount: 24, currency: "USD" }],
    },
    currentUserId: "me",
  });
  assert.doesNotMatch(text(owed), /Settled|Even/i);
  assert.match(text(owed), /You're owed \$24\.00/);
  assert.doesNotMatch(text(owed), /^\+|−|-/);
  assert.equal(nodes(owed).some((n) => n.props?.testID === "group-balance-amount"), true);

  const owe = Badge({
    balanceData: {
      group_id: "g",
      balances: [{ user_id: "me", amount: -86.4, currency: "USD" }],
    },
    currentUserId: "me",
  });
  assert.match(text(owe), /You owe \$86\.40/);
});

test("loading skeleton matches amount-line height in the shared right-aligned slot", () => {
  const Badge = loadBadge(lightTheme);
  const balanceData = { group_id: "g", balances: [{ user_id: "me", amount: 3000, currency: "INR" }] };
  const trees = [Badge({ loading: true }), Badge({ loading: false }), Badge({ balanceData, currentUserId: "me" })];
  const slots = trees.map(tree => Object.assign({}, ...tree.props.style.filter(Boolean)));
  slots.forEach(slot => {
    assert.equal(slot.width, 152);
    assert.equal(slot.flexShrink, 0);
    assert.equal(slot.alignItems, "flex-end");
  });
  assert.deepEqual(slots[0], slots[1]);
  assert.deepEqual(slots[1], slots[2]);
  const skeleton = nodes(trees[0]).find((n) => n.type === "Skeleton");
  assert.equal(skeleton.props.height, 16);
});
