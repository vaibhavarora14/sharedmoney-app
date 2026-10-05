const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

// Run actual components and currency/debt helpers; only native views and the
// preference hook are opaque boundaries. No API or native runtime is required.
function components(preferences = {}, theme = { colors: {} }, dimensions = { width: 402, fontScale: 1 }) {
  const cache = new Map();
  const paper = Object.fromEntries(["ActivityIndicator", "Button", "Divider", "Surface", "Text", "TouchableRipple"].map(name => [name, name]));
  paper.Avatar = { Text: "Avatar.Text" };
  paper.useTheme = () => ({ ...theme, fonts: { labelLarge: { lineHeight: 20 }, bodySmall: { lineHeight: 16 } } });
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = (id) => {
      if (id === "react") return { ...React, useMemo: fn => fn() };
      if (id === "react-native") return { View: "View", useWindowDimensions: () => dimensions, StyleSheet: { create: styles => styles, hairlineWidth: 1 } };
      if (id === "react-native-paper") return paper;
      if (id === "./Skeleton") return { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" };
      if (id === "@expo/vector-icons/MaterialCommunityIcons") return "Icon";
      if (id === "../hooks/useCurrencyPreferences") return { useCurrencyPreferences: () => ({ rateBook: {}, ...preferences }) };
      if (["./UnifiedBalanceHero", "./UnifyPromptCard"].includes(id)) return { [id.slice(2)]: id.slice(2) };
      if (id.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filename), id);
        return load(existsSync(resolved) ? resolved : `${resolved}.ts`);
      }
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    ...load(path.join(__dirname, "GroupDashboard.tsx")),
    ...load(path.join(__dirname, "BalancesSection.tsx")),
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.Children.toArray(tree?.props?.children).map(text).join("");
}
function byId(tree, id) {
  const result = nodes(tree).find(node => node.props.testID === id);
  assert.ok(result, `Expected ${id}`);
  return result;
}
function flatten(style) {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}
const balance = (id, amount, currency = "USD") => ({ participant_id: id, user_id: id, full_name: id === "me" ? "You" : id, amount, currency });
const dashboard = (balances, overrides = {}, preferences = {}) => components(preferences).GroupDashboard({ balances, currentUserId: "me", defaultCurrency: "USD", loading: false, activeMemberCount: 3, ...overrides });

function themes() {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '../theme.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', code)(name => name === 'react-native'
    ? { Platform: { select: options => options.default } }
    : { MD3LightTheme: { dark: false }, MD3DarkTheme: { dark: true }, configureFonts: () => ({}) }, module.exports);
  return [module.exports.lightTheme, module.exports.darkTheme];
}
function contrast(a, b) {
  const luminance = hex => {
    const rgb = hex.replace('#', '').match(/../g).map(c => parseInt(c, 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (x + 0.05) / (y + 0.05);
}
test('balance initials and small polarity text meet normal-text contrast in both themes', () => {
  for (const theme of themes().reverse()) {
    const tree = components({}, theme).BalancesSection({ groupBalances: [], overallBalances: ['a', 'b', 'c', 'd', 'e'].map((id, i) => balance(id, i % 2 ? -20 : 20)), loading: false });
    for (const avatar of nodes(tree).filter(node => node.type === 'Avatar.Text')) {
      assert.ok(contrast(avatar.props.color, avatar.props.style.backgroundColor) >= 4.5, `${theme.dark ? 'dark' : 'light'} initials`);
    }
    const rows = byId(tree, 'balances-person-list');
    for (const label of nodes(rows).filter(node => node.type === 'Text' && ['titleSmall', 'bodySmall'].includes(node.props.variant))) {
      assert.ok(contrast(label.props.style.color, theme.colors.surface) >= 4.5, `${theme.dark ? 'dark' : 'light'} ${text(label)}`);
    }
  }
});

function settlementRows(tree) {
  return nodes(tree).filter(node => typeof node.props?.testID === "string" && node.props.testID.startsWith("settlement-row-"));
}

test("dashboard creditor sees Alice owes you, not the viewer's own net row", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], { onSettlePress: () => {} });
  assert.match(text(tree), /Alice owes you/);
  assert.doesNotMatch(text(tree), /You owes you|You owe Alice/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /\+\$50\.00/);
  assert.equal(rows[0].props.accessibilityLabel, "Alice owes you, +$50.00");
  assert.equal(rows[0].props.accessibilityRole, "button");
});
test("dashboard debtor sees You owe Alice, never Alice owes you", () => {
  const tree = dashboard([balance("me", -50), balance("Alice", 50)]);
  assert.match(text(tree), /You owe Alice/);
  assert.doesNotMatch(text(tree), /Alice owes you|You owe You/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /-\$50\.00/);
});
test("dashboard uses the viewer's edge amount, not the counterparty's group net", () => {
  const tree = dashboard([balance("me", 20), balance("Alice", -100), balance("Bob", 80)]);
  assert.match(text(tree), /Alice owes you/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /\+\$20\.00/);
  assert.doesNotMatch(text(rows[0]), /100|80/);
});
test("dashboard recognizes viewer by participant id and keeps edge currencies", () => {
  const tree = dashboard([
    { ...balance("viewer-participant", 50), user_id: null }, balance("Alice", -50),
    { ...balance("viewer-participant", -30, "EUR"), user_id: null }, balance("Bob", 30, "EUR"),
  ], { currentUserParticipantId: "viewer-participant" });
  assert.match(text(tree), /Alice owes you/);
  assert.match(text(tree), /You owe Bob/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 2);
  assert.match(text(byId(tree, "group-settlement-rows")), /\+\$50\.00/);
  assert.match(text(byId(tree, "group-settlement-rows")), /-€30\.00/);
  assert.doesNotMatch(text(byId(tree, "group-settlement-rows")), /80\.00|20\.00/);
});

test("dashboard unification renders compact viewer-involved rows in the settlement currency", () => {
  const tree = dashboard([
    balance("me", 50), balance("Alice", -50),
    balance("me", -20, "EUR"), balance("Bob", 20, "EUR"),
  ], { onOpenCurrencySettings: () => {} }, {
    groupSettings: { enabled: true, settlementCurrency: "USD" },
    rateBook: { usdRates: { USD: 1, EUR: 0.8 }, overrides: {} },
  });
  assert.ok(byId(tree, "group-settlement-rows"));
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /Alice owes you/);
  assert.match(text(rows[0]), /\+\$25\.00/);
  assert.match(text(tree), /In one currency · USD/);
  assert.match(text(tree), /Rates ›/);
  assert.equal(nodes(tree).some(node => node.type === "UnifiedBalanceHero"), false);
});

test("dashboard unification preserves original-currency missing-rate leftovers without false settled", () => {
  const tree = dashboard([
    balance("me", 50), balance("Alice", -50),
    balance("me", 20, "GBP"), balance("Cara", -20, "GBP"),
  ], {}, {
    groupSettings: { enabled: true, settlementCurrency: "INR" },
    rateBook: { usdRates: { USD: 1, INR: 83 }, overrides: {} },
  });
  const rows = settlementRows(tree);
  assert.equal(rows.length, 2);
  const converted = rows.find(r => text(r).includes("Alice"));
  const leftover = rows.find(r => text(r).includes("Cara"));
  assert.ok(converted);
  assert.ok(leftover);
  assert.match(text(converted), /₹4,150\.00/);
  assert.match(text(leftover), /£20\.00/);
  assert.match(text(leftover), /Not converted · GBP/);
  assert.match(text(tree), /No GBP → INR rate/);
  assert.doesNotMatch(text(tree), /All settled/);
});

test("dashboard unification true zero without missing rates shows All settled", () => {
  const tree = dashboard([
    balance("me", 0), balance("Alice", 0),
  ], { activeMemberCount: 2 }, {
    groupSettings: { enabled: true, settlementCurrency: "USD" },
    rateBook: { usdRates: { USD: 1, EUR: 0.8 }, overrides: {} },
  });
  assert.equal(settlementRows(tree).length, 0);
  assert.match(text(byId(tree, "group-settlement-rows")), /All settled/);
});

test("dashboard unification zero converted amount with missing rate does not show false All settled", () => {
  const tree = dashboard([
    balance("me", 0), balance("Alice", 0),
    balance("me", 20, "GBP"), balance("Bob", -20, "GBP"),
  ], { activeMemberCount: 2 }, {
    groupSettings: { enabled: true, settlementCurrency: "INR" },
    rateBook: { usdRates: { USD: 1, INR: 83 }, overrides: {} },
  });
  assert.doesNotMatch(text(tree), /All settled/);
  assert.match(text(tree), /Not converted · GBP/);
});

test("dashboard unification preserves greedy simplification with multiple counterparties", () => {
  const tree = dashboard([
    balance("me", 100), balance("Bob", -60), balance("Charlie", -40),
  ], {}, {
    groupSettings: { enabled: true, settlementCurrency: "INR" },
    rateBook: { usdRates: { USD: 1, INR: 83 }, overrides: {} },
  });
  const rows = settlementRows(tree);
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /Bob owes you/);
  assert.match(text(rows[0]), /₹4,980\.00/);
  assert.match(text(rows[1]), /Charlie owes you/);
  assert.match(text(rows[1]), /₹3,320\.00/);
});
test("dashboard does not label third-party debts as debts to the viewer", () => {
  const tree = dashboard([balance("me", 0), balance("Alice", -50), balance("Bob", 50)]);
  assert.doesNotMatch(text(tree), /Alice owes you|Bob owes you|You owe Alice|You owe Bob/);
  assert.equal(settlementRows(tree).length, 0);
  assert.match(text(byId(tree, "group-settlement-rows")), /All settled/);
});

test("dashboard one settlement renders exactly one compact row", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)]);
  assert.equal(settlementRows(tree).length, 1);
  assert.ok(byId(tree, "group-settlement-rows"));
});
test("dashboard both directions render two compact rows", () => {
  const tree = dashboard([
    balance("me", 50), balance("Alice", -50),
    balance("me", -30), balance("Bob", 30),
  ]);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 2);
  assert.match(text(tree), /Alice owes you/);
  assert.match(text(tree), /You owe Bob/);
});
test("settled multi-member group shows quiet status without a settlement action", () => {
  for (const balances of [[], [balance("me", 0), balance("Bob", 0)]]) {
    const tree = dashboard(balances, { activeMemberCount: 2, onSettlePress: () => assert.fail("No debt to record") });
    const panel = byId(tree, "group-settlement-rows");
    assert.ok(panel, "settled group must not silently hide its status");
    assert.match(text(panel), /All settled/);
    assert.equal(panel.type, "View", "settled status must not use a card surface");
    const status = byId(panel, "group-settled-inline");
    assert.ok(status);
    assert.equal(status.props.style.flexDirection, "row");
    assert.equal(status.props.style.minHeight, undefined);
    assert.equal(status.props.style.backgroundColor, undefined);
    assert.equal(status.props.style.borderWidth, undefined);
    assert.ok(status.props.style.paddingVertical <= 4);
    assert.ok(nodes(status).some(n => n.type === "Icon" && n.props.name === "check-circle-outline"));
    assert.equal(settlementRows(tree).length, 0);
    assert.equal(nodes(panel).some(n => n.props.onPress || n.props.accessibilityRole === "button"), false);
  }
});

test("solo group does not gain settlement chrome", () => {
  const tree = dashboard([], { activeMemberCount: 1 });
  assert.equal(nodes(tree).find(n => n.props.testID === "group-settlement-rows"), undefined);
});

test("dashboard reserves settlement and both stat cards while balances load", () => {
  for (const loading of [{ loading: true }, { statsLoading: true }]) {
    const tree = dashboard([balance("me", 50), balance("Alice", -50)], loading);
    assert.equal(settlementRows(tree).length, 0);
    assert.ok(byId(tree, "group-dashboard-skeleton"));
    assert.ok(byId(tree, "group-settlement-skeleton"));
    assert.equal(nodes(tree).filter(n => n.props.testID === "group-stat-skeleton").length, 2);
    assert.doesNotMatch(text(tree), /Updating balances|Alice owes you|All settled|\$50/);
  }
});

test("settled unified dashboard keeps the same region geometry as its skeleton at both font scales", () => {
  for (const fontScale of [1, 1.5]) {
    const { GroupDashboard } = components({
      groupSettings: { enabled: true, settlementCurrency: "INR" },
    }, { colors: {} }, { width: 402, fontScale });
    const props = { balances: [], currentUserId: "me", activeMemberCount: 3 };
    const skeleton = GroupDashboard({ ...props, loading: true });
    const loaded = GroupDashboard({ ...props, loading: false });
    assert.deepEqual(skeleton.props.style, loaded.props.style);
    // The currency subhead and its margin/gap occupy identical space.
    const pendingSubhead = React.Children.toArray(skeleton.props.children)[0];
    const loadedSubhead = React.Children.toArray(loaded.props.children)[0];
    assert.deepEqual(flatten(pendingSubhead.props.style), flatten(loadedSubhead.props.style));
    const pendingCards = nodes(skeleton).filter(n => n.type === "Surface");
    const loadedCards = nodes(loaded).filter(n => n.type === "Surface");
    assert.equal(pendingCards.length, 2);
    assert.equal(loadedCards.length, 2);
    pendingCards.forEach((card, i) => {
      assert.deepEqual(flatten(card.props.style), flatten(loadedCards[i].props.style));
      assert.equal(flatten(card.props.style).minHeight, 110 * fontScale);
    });
    assert.deepEqual(byId(skeleton, "group-settlement-skeleton").props.style,
      byId(loaded, "group-settled-inline").props.style);
  }
});

test("balance summary adds only matching currencies on both sides", () => {
  const { BalancesSection } = components();
  const balances = [balance("Alice", 100), balance("Bob", 100, "INR"), balance("Cara", 20), balance("Dan", -40), balance("Eve", -60, "EUR"), balance("Frank", -10, "EUR")];
  for (const showOverallBalances of [true, false]) {
    const tree = BalancesSection({ groupBalances: [{ group_id: "g", balances }], overallBalances: showOverallBalances ? balances : [], showOverallBalances, defaultCurrency: "USD", loading: false });
    const owed = text(byId(tree, "balances-summary-owed"));
    const owe = text(byId(tree, "balances-summary-owe"));
    assert.match(owed, /\$120\.00/);
    assert.match(owed, /₹100\.00/);
    assert.match(owe, /\$40\.00/);
    assert.match(owe, /€70\.00/);
    assert.doesNotMatch(owed + owe, /220\.00|110\.00/);
  }
});
test("balance summary preserves already-converted currency and default zero", () => {
  const tree = components().BalancesSection({ groupBalances: [], overallBalances: [balance("Alice", 110), balance("Bob", 20)], defaultCurrency: "USD", loading: false });
  assert.equal(text(byId(tree, "balances-summary-owed")), "$130.00");
  assert.equal(text(byId(tree, "balances-summary-owe")), "$0.00");
});

test("BalancesSection person rows stay non-actionable even with onSettleUp", () => {
  const onSettle = () => assert.fail("Balance rows must not settle");
  const section = components().BalancesSection({
    groupBalances: [],
    overallBalances: [balance("Alice", 50), balance("Bob", -20)],
    loading: false,
    onSettleUp: onSettle,
  });
  assert.ok(nodes(section).length > 1);
  assert.doesNotMatch(text(section), /\b(settle|pay|receive)\b/i);
  for (const node of nodes(section)) {
    assert.equal(node.props.onPress, undefined);
    assert.equal(node.props.onLongPress, undefined);
    assert.notEqual(node.props.accessibilityRole, "button");
  }
});
test("GroupDashboard settlement rows are pressable only when pressed", () => {
  let pressed = null;
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], {
    onSettlePress: (balance) => { pressed = balance; },
  });
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(typeof row.props.onPress, "function");
  assert.equal(row.props.accessibilityRole, "button");
  assert.equal(row.props.accessibilityLabel, "Alice owes you, +$50.00");
  assert.ok((row.props.style?.minHeight ?? 0) >= 44);
  assert.equal(pressed, null);
  row.props.onPress();
  assert.equal(pressed?.full_name, "Alice");
  assert.equal(pressed?.amount, 50);
});

test("dashboard accessible settlement label includes counterparty, direction, and signed amount", () => {
  const owed = dashboard([balance("me", 50), balance("Alice", -50)], { onSettlePress: () => {} });
  assert.equal(settlementRows(owed)[0].props.accessibilityLabel, "Alice owes you, +$50.00");
  const owe = dashboard([balance("me", -40), balance("Bob", 40)], { onSettlePress: () => {} });
  assert.equal(settlementRows(owe)[0].props.accessibilityLabel, "You owe Bob, -$40.00");
  const eur = dashboard([
    { ...balance("me", -30, "EUR") }, balance("Cara", 30, "EUR"),
  ], { onSettlePress: () => {} });
  assert.equal(settlementRows(eur)[0].props.accessibilityLabel, "You owe Cara, -€30.00");
});

test("dashboard settlement row layout reflows without one-line truncation or font caps", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], { onSettlePress: () => {} });
  const row = settlementRows(tree)[0];
  const rowStyle = flatten(row.props.style);
  assert.equal(rowStyle.height, undefined);
  assert.ok((rowStyle.minHeight ?? 0) >= 44);
  const content = row.props.children;
  const contentStyle = flatten(content.props.style);
  assert.equal(contentStyle.height, undefined);
  assert.ok((contentStyle.minHeight ?? 0) >= 44);
  const texts = nodes(row).filter(node => node.type === "Text");
  const direction = texts.find(node => /Alice owes you/.test(text(node)));
  const amount = texts.find(node => /\+\$50\.00/.test(text(node)));
  assert.ok(direction);
  assert.ok(amount);
  assert.equal(direction.props.numberOfLines, undefined);
  assert.equal(amount.props.numberOfLines, undefined);
  assert.notEqual(direction.props.allowFontScaling, false);
  assert.notEqual(amount.props.allowFontScaling, false);
  assert.equal(direction.props.maxFontSizeMultiplier, undefined);
  assert.equal(amount.props.maxFontSizeMultiplier, undefined);
  assert.equal(flatten(amount.props.style).flexShrink, 1);
  assert.equal(flatten(direction.props.style).flexShrink, 1);
});

test("settlement chevron stays outside the reflowing text and initials grow with text", () => {
  const tree = dashboard([balance("me", 30000), balance("Alexandria", -30000)], { onSettlePress: () => {} });
  const row = settlementRows(tree)[0];
  const content = row.props.children;
  assert.notEqual(flatten(content.props.style).flexWrap, "wrap", "chevron must not become a separate flex line");
  const children = React.Children.toArray(content.props.children);
  const detail = children.find(n => /Alexandria owes you/.test(text(n)) && /30,000/.test(text(n)));
  assert.ok(detail, "direction and amount reflow together inside the available row width");
  assert.equal(flatten(detail.props.style).minWidth, 0);
  assert.equal(flatten(detail.props.style).flex, 1);
  assert.equal(children.at(-1).props.name, "chevron-right");
  assert.equal(nodes(row).some(n => n.type === "Avatar.Text"), false, "fixed Paper avatar clips enlarged initials");
  const initials = nodes(row).find(n => n.type === "Text" && text(n) === "AL");
  assert.ok(initials);
  assert.equal(initials.props.numberOfLines, undefined);
  assert.equal(initials.props.maxFontSizeMultiplier, undefined);
});

test("dashboard insights stack at enlarged text and preserve full financial labels", () => {
  for (const fontScale of [1, 2]) {
    const tree = components({}, { colors: {} }, { width: 402, fontScale }).GroupDashboard({
      balances: [], currentUserId: "me", loading: false, defaultCurrency: "USD",
    });
    const stats = React.Children.toArray(tree.props.children).at(-1);
    assert.equal(flatten(stats.props.style).flexDirection, fontScale === 1 ? "row" : "column");
    for (const value of nodes(stats).filter(n => n.type === "Text")) {
      assert.equal(value.props.numberOfLines, undefined, "financial summaries must not silently truncate");
      assert.equal(value.props.maxFontSizeMultiplier, undefined);
    }
  }
});

test("dashboard balanceError with stale balances shows error, not actionable rows or All settled", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], {
    balanceError: true,
    onSettlePress: () => assert.fail("must not settle while balances are unknown"),
  });
  assert.equal(settlementRows(tree).length, 0);
  assert.ok(byId(tree, "group-settlement-rows"));
  assert.match(text(byId(tree, "group-settlement-rows")), /Couldn.t load balances/);
  assert.doesNotMatch(text(tree), /Updating balances|All settled|Alice owes you|\$50/);
});

test("dashboard balanceError with empty balances still shows error status, not All settled", () => {
  const tree = dashboard([], { balanceError: true, activeMemberCount: 3 });
  assert.equal(settlementRows(tree).length, 0);
  assert.ok(byId(tree, "group-settlement-rows"));
  assert.match(text(byId(tree, "group-settlement-rows")), /Couldn.t load balances/);
  assert.doesNotMatch(text(tree), /Updating balances|All settled/);
});

test("dashboard without onSettlePress is informational: no button role, chevron, or press handler", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)]);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.props.onPress, undefined);
  assert.notEqual(row.props.accessibilityRole, "button");
  assert.equal(nodes(row).some(node => node.type === "Icon" && node.props.name === "chevron-right"), false);
  assert.match(text(row), /Alice owes you/);
  assert.match(text(row), /\+\$50\.00/);
});

test("GroupDetailsScreen wires balanceError and gates onSettlePress for active members only", () => {
  const source = readFileSync(path.join(__dirname, "../screens/GroupDetailsScreen.tsx"), "utf8");
  assert.match(source, /error:\s*balancesError/);
  assert.match(source, /balanceError=\{\!\!balancesError\}/);
  assert.match(source, /onSettlePress=\{isActiveMember && !balancesError \? handleSettleUp : undefined\}/);
  assert.match(source, /if\s*\(\s*!isActiveMember\s*\|\|\s*balancesError\s*\)\s*return/);
});

test("GroupDetailsScreen wires independent dashboard and ledger skeletons", () => {
  const source = readFileSync(path.join(__dirname, "../screens/GroupDetailsScreen.tsx"), "utf8");
  assert.match(source, /loading=\{loadingTreatment\.showDashboardSkeleton\}/);
  assert.match(source, /refreshing=\{loadingTreatment\.showRefreshControlLoader\}/);
  assert.match(source, /loadingTreatment\.showFooterLoader/);
  assert.match(source, /<LedgerSkeleton \/>/);
  assert.doesNotMatch(source, /quietLoading|Loading group details/);
});

test("App prefetchGroupData fetches balances with include_stats for shared key", () => {
  const source = readFileSync(path.join(__dirname, "../App.tsx"), "utf8");
  assert.match(source, /prefetchGroupData/);
  assert.match(source, /fetchBalances\(groupId,\s*true\)/);
  assert.match(source, /queryKeys\.groupStats\(groupId\)/);
  assert.doesNotMatch(
    source,
    /queryKey:\s*queryKeys\.balances\(groupId\),[\s\S]{0,80}queryFn:\s*\(\)\s*=>\s*fetchBalances\(groupId\)/
  );
});

test("useBalances refetches when includeStats cache lacks group_stats", () => {
  const hook = readFileSync(path.join(__dirname, "../hooks/useBalances.ts"), "utf8");
  const helper = readFileSync(path.join(__dirname, "../hooks/balancesCacheStats.ts"), "utf8");
  assert.match(helper, /group_stats == null/);
  assert.match(hook, /balancesCacheMissingStats/);
  assert.match(hook, /refetchOnMount/);
  assert.match(hook, /statsRefetchAttempted/);
});
