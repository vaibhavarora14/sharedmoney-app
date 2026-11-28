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
  let state;
  let initialized = false;
  const paper = Object.fromEntries(["ActivityIndicator", "Button", "Divider", "Surface", "Text", "TouchableRipple"].map(name => [name, name]));
  paper.Avatar = { Text: "Avatar.Text", Image: "Avatar.Image", Icon: "Avatar.Icon" };
  paper.useTheme = () => ({ ...theme, fonts: { labelLarge: { lineHeight: 20 }, bodySmall: { lineHeight: 16 } } });
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = (id) => {
      if (id === "react") return { ...React, useMemo: fn => fn(), useEffect: () => {}, useState: initial => {
        if (!initialized) { state = typeof initial === "function" ? initial() : initial; initialized = true; }
        return [state, () => {}];
      } };
      if (id === "react-native") return { View: "View", Pressable: "Pressable", useWindowDimensions: () => dimensions, StyleSheet: { create: styles => styles, flatten: (value) => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)), hairlineWidth: 1 } };
      if (id === "react-native-paper") return paper;
      if (id === "./Skeleton") return { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" };
      if (id === "@expo/vector-icons/MaterialCommunityIcons") return "Icon";
      if (id === "../hooks/useCurrencyPreferences") return { useCurrencyPreferences: () => ({ rateBook: {}, ...preferences }) };
      if (["./UnifiedBalanceHero", "./UnifyPromptCard"].includes(id)) return { [id.slice(2)]: id.slice(2) };
      if (id.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filename), id);
        const hit = [resolved, `${resolved}.tsx`, `${resolved}.ts`].find((candidate) => existsSync(candidate));
        return load(hit || `${resolved}.ts`);
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
const dashboard = (balances, overrides = {}, preferences = {}) => components(preferences).GroupDashboard({
  balances,
  currentUserId: "me",
  defaultCurrency: "USD",
  loading: false,
  activeMemberCount: 3,
  settleListOpen: true,
  ...overrides,
});

function themes() {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '../theme.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', code)((name) => {
    if (name === 'react-native') return { Platform: { select: options => options.default } };
    if (name === './themeTokens') {
      const tokens = { exports: {} };
      const tokenCode = ts.transpileModule(readFileSync(path.join(__dirname, '../themeTokens.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText;
      new Function('exports', tokenCode)(tokens.exports);
      return tokens.exports;
    }
    return {
      MD3LightTheme: { dark: false, colors: {} },
      MD3DarkTheme: { dark: true, colors: {} },
      configureFonts: () => ({}),
    };
  }, module.exports);
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
  // Row pressables use `settlement-row-<id>-<currency>`; ignore nested label ids.
  const nested = new Set([
    "settlement-row-name",
    "settlement-row-amount",
    "settlement-row-presence",
    "settlement-row-line1",
  ]);
  return nodes(tree).filter((node) => {
    const id = node.props?.testID;
    return typeof id === "string"
      && id.startsWith("settlement-row-")
      && !nested.has(id);
  });
}

test("dashboard creditor sees Alice owes you, not the viewer's own net row", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], { onSettlePress: () => {} });
  assert.match(text(tree), /Alice owes you/);
  assert.doesNotMatch(text(tree), /You owes you|You owe Alice/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /\$50(?!\.00)/);
  assert.doesNotMatch(text(rows[0]), /\+/);
  assert.equal(rows[0].props.accessibilityLabel, "Alice owes you, $50");
  assert.equal(rows[0].props.accessibilityRole, "button");
});
test("dashboard debtor sees You owe Alice, never Alice owes you", () => {
  const tree = dashboard([balance("me", -50), balance("Alice", 50)]);
  assert.match(text(tree), /You owe Alice/);
  assert.doesNotMatch(text(tree), /Alice owes you|You owe You/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /\$50(?!\.00)/);
  assert.doesNotMatch(text(rows[0]), /-/);
});
test("dashboard uses the viewer's edge amount, not the counterparty's group net", () => {
  const tree = dashboard([balance("me", 20), balance("Alice", -100), balance("Bob", 80)]);
  assert.match(text(tree), /Alice owes you/);
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /\$20(?!\.00)/);
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
  assert.match(text(byId(tree, "group-settlement-rows")), /\$50(?!\.00)/);
  assert.match(text(byId(tree, "group-settlement-rows")), /€30(?!\.00)/);
  assert.doesNotMatch(text(byId(tree, "group-settlement-rows")), /\+|-/);
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
  assert.match(text(rows[0]), /\$25(?!\.00)/);
  assert.match(text(byId(tree, "group-position-number")), /\$25/);
  assert.match(text(byId(tree, "group-position-label")), /You're owed/);
  assert.doesNotMatch(text(tree), /Rates ›/);
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
  assert.match(text(converted), /₹4,150(?!\.00)/);
  assert.match(text(leftover), /£20(?!\.00)/);
  assert.match(text(leftover), /Not converted · GBP/);
  assert.match(text(tree), /No GBP → INR rate/);
  assert.doesNotMatch(text(tree), /All settled/);
});

test("dashboard unification true zero without missing rates shows You're even", () => {
  const tree = dashboard([
    balance("me", 0), balance("Alice", 0),
  ], { activeMemberCount: 2, settleListOpen: false }, {
    groupSettings: { enabled: true, settlementCurrency: "USD" },
    rateBook: { usdRates: { USD: 1, EUR: 0.8 }, overrides: {} },
  });
  assert.equal(settlementRows(tree).length, 0);
  assert.match(text(byId(tree, "group-position-label")), /You're even/);
  assert.equal(nodes(tree).find(n => n.props.testID === "settle-up-button"), undefined);
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
  assert.match(text(rows[0]), /₹4,980(?!\.00)/);
  assert.match(text(rows[1]), /Charlie owes you/);
  assert.match(text(rows[1]), /₹3,320(?!\.00)/);
});
test("dashboard does not label third-party debts as debts to the viewer", () => {
  const tree = dashboard([balance("me", 0), balance("Alice", -50), balance("Bob", 50)]);
  assert.doesNotMatch(text(tree), /Alice owes you|Bob owes you|You owe Alice|You owe Bob/);
  assert.equal(settlementRows(tree).length, 0);
  assert.match(text(byId(tree, "group-position-label")), /You're even/);
});

test("dashboard one settlement renders exactly one compact row", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)]);
  assert.equal(settlementRows(tree).length, 1);
  assert.ok(byId(tree, "group-settlement-rows"));
});
test("dashboard disambiguates two members who share a first name", () => {
  const tree = dashboard([
    balance("me", 2400, "INR"),
    { ...balance("cf", -1600, "INR"), full_name: "Christopher Fernandez" },
    { ...balance("cm", -800, "INR"), full_name: "Christopher Mills" },
  ], {
    participants: [
      { id: "me", user_id: "me", type: "member", full_name: "Asha Rao" },
      { id: "cf", user_id: "cf", type: "member", full_name: "Christopher Fernandez" },
      { id: "cm", user_id: "cm", type: "member", full_name: "Christopher Mills" },
    ],
    defaultCurrency: "INR",
  });
  const rows = settlementRows(tree);
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /Christopher F\. owes you/);
  assert.match(text(rows[1]), /Christopher M\. owes you/);
  assert.equal(nodes(tree).some((node) => node.props?.testID === "group-position-sentence"), false);
  assert.doesNotMatch(text(tree), /Christopher F\. owes ₹1,600 · Christopher M\. ₹800/);
  assert.doesNotMatch(text(tree), /Christopher Fernandez|Christopher Mills/);
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
test("settled multi-member group shows You're even without Settle up", () => {
  for (const balances of [[], [balance("me", 0), balance("Bob", 0)]]) {
    const tree = dashboard(balances, {
      activeMemberCount: 2,
      settleListOpen: false,
      onSettlePress: () => assert.fail("No debt to record"),
      onOpenSettle: () => assert.fail("No debt to settle"),
    });
    const panel = byId(tree, "group-position");
    assert.match(text(byId(panel, "group-position-label")), /You're even/);
    assert.match(text(byId(panel, "group-position-number")), /\$0/);
    assert.equal(nodes(tree).find(n => n.props.testID === "settle-up-button"), undefined);
    assert.equal(nodes(tree).find(n => n.props.testID === "remind-button"), undefined);
    assert.equal(settlementRows(tree).length, 0);
  }
});

test("solo group does not gain settlement chrome", () => {
  const tree = dashboard([], { activeMemberCount: 1 });
  assert.equal(nodes(tree).find(n => n.props.testID === "group-settlement-rows"), undefined);
});

test("one active member + person without account shows two-line settle row", () => {
  const sheeba = {
    participant_id: "p_sheeba",
    user_id: "",
    full_name: "Sheeba",
    amount: -3000,
    currency: "INR",
  };
  const tree = dashboard(
    [balance("me", 3000, "INR"), sheeba],
    {
      activeMemberCount: 2,
      hasNonZeroBalance: true,
      participants: [
        { id: "p_me", user_id: "me", type: "member", full_name: "You" },
        { id: "p_sheeba", user_id: null, type: "member", full_name: "Sheeba" },
      ],
      defaultCurrency: "INR",
      onSettlePress: () => {},
    },
  );
  assert.ok(nodes(tree).find(n => n.props.testID === "group-settlement-rows"));
  const nameNode = nodes(tree).find(n => n.props?.testID === "settlement-row-name");
  assert.equal(text(nameNode), "Sheeba");
  assert.equal(flatten(nameNode.props.style).flexShrink, 1);
  const line1 = nodes(tree).find(n => n.props?.testID === "settlement-row-line1");
  assert.match(text(line1), /Sheeba owes you/);
  assert.doesNotMatch(text(line1), /Not on SharedMoney|·/);
  const caption = nodes(tree).find(n => n.props?.testID === "settlement-row-presence");
  assert.equal(text(caption), "Not on SharedMoney");
  assert.equal(caption.props.style.fontSize, 13);
  const amountNode = nodes(tree).find(n => n.props?.testID === "settlement-row-amount");
  assert.ok(amountNode);
  assert.equal(flatten(amountNode.props.style).flexShrink, 0);
  const details = nodes(tree).find(n => flatten(n.props?.style)?.alignItems === "flex-start"
    && nodes(n).some(c => c.props?.testID === "settlement-row-amount"));
  assert.ok(details, "amount column top-aligns with line 1");
  const labelColumn = nodes(tree).find(n => n.props?.testID === "settlement-label-column");
  assert.equal(flatten(labelColumn.props.style).flex, 1);
  assert.equal(flatten(labelColumn.props.style).minWidth, 0);
});

test("no-account settle row resolves typed name from participants when balance full_name is empty", () => {
  const sheeba = {
    participant_id: "p_sheeba",
    user_id: "",
    full_name: null,
    email: "sheeba@example.com",
    amount: -3000,
    currency: "INR",
  };
  const tree = dashboard(
    [balance("me", 3000, "INR"), sheeba],
    {
      activeMemberCount: 2,
      hasNonZeroBalance: true,
      participants: [
        { id: "p_me", user_id: "me", type: "member", full_name: "You" },
        {
          id: "p_sheeba",
          user_id: null,
          type: "member",
          full_name: "Sheeba",
          email: "sheeba@example.com",
          phone: "+919876543210",
        },
      ],
      defaultCurrency: "INR",
      onSettlePress: () => {},
    },
  );
  const nameNode = nodes(tree).find(n => n.props?.testID === "settlement-row-name");
  assert.equal(text(nameNode), "Sheeba");
  assert.doesNotMatch(text(tree), /sheeba@example\.com|\+919876543210/);
  assert.equal(text(nodes(tree).find(n => n.props?.testID === "settlement-row-presence")), "Not on SharedMoney");
});

test("pending-invite settle row shows Invited caption on line 2", () => {
  const invited = {
    participant_id: "p_inv",
    user_id: "",
    full_name: "Riya",
    amount: -20,
    currency: "USD",
  };
  const tree = dashboard(
    [balance("me", 20), invited],
    {
      activeMemberCount: 2,
      hasNonZeroBalance: true,
      participants: [
        { id: "p_me", user_id: "me", type: "member", full_name: "You" },
        { id: "p_inv", user_id: null, type: "invited", full_name: "Riya" },
      ],
      onSettlePress: () => {},
    },
  );
  assert.match(text(nodes(tree).find(n => n.props?.testID === "settlement-row-line1")), /Riya owes you/);
  assert.equal(text(nodes(tree).find(n => n.props?.testID === "settlement-row-presence")), "Invited");
});

test("solo count with non-zero balance still shows settle chrome", () => {
  const tree = dashboard(
    [balance("me", 50), balance("Alice", -50)],
    { activeMemberCount: 1, hasNonZeroBalance: true },
  );
  assert.ok(nodes(tree).find(n => n.props.testID === "group-settlement-rows"));
});

test("former counterparty keeps Former styling on settle row", () => {
  const former = {
    participant_id: "p_former",
    user_id: "u_former",
    full_name: "Alex",
    amount: -40,
    currency: "USD",
  };
  const tree = dashboard(
    [balance("me", 40), former],
    {
      activeMemberCount: 1,
      hasNonZeroBalance: true,
      participants: [
        { id: "p_me", user_id: "me", type: "member", full_name: "You" },
        { id: "p_former", user_id: "u_former", type: "former", full_name: "Alex" },
      ],
      onSettlePress: () => {},
    },
  );
  assert.match(text(tree), /Former/);
  assert.match(text(tree), /Alex/);
});

test("dashboard reserves one number placeholder and not spending cards while balances load", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], { loading: true });
  assert.equal(settlementRows(tree).length, 0);
  assert.ok(byId(tree, "group-position-placeholder"));
  assert.equal(nodes(tree).filter(n => n.props.testID === "group-stat-skeleton").length, 0);
  assert.doesNotMatch(text(tree), /My spending|Group summary|Updating balances|Alice owes you|All settled|You're even|\$50/);
  const withStatsOnly = dashboard([balance("me", 50), balance("Alice", -50)], { statsLoading: true });
  assert.match(text(withStatsOnly), /\$50/);
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
    assert.equal(React.Children.toArray(skeleton.props.children).length, 1);
    assert.equal(React.Children.toArray(loaded.props.children).length, 1);
    assert.ok(byId(skeleton, "group-position-placeholder"));
    assert.doesNotMatch(text(skeleton), /You're even|All settled/);
    assert.match(text(loaded), /You're even/);
    assert.doesNotMatch(text(loaded), /My spending|Group summary/);
  }
});

// Missing members are unknown; later counts must not change the loading shell.
test("dashboard skeleton geometry survives member and currency hydration in either order", () => {
  for (const fontScale of [1, 1.5]) {
    const preferences = { groupSettings: null };
    const { GroupDashboard } = components(preferences, { colors: {} }, { width: 402, fontScale });
    const props = { balances: [], currentUserId: "me", loading: true };
    const geometry = tree => React.Children.toArray(tree.props.children).map(node => flatten(node.props.style));
    const firstFrame = geometry(GroupDashboard({ ...props, membersKnown: false, activeMemberCount: 0 }));
    assert.equal(firstFrame.length, 1, "reserve one number placeholder on first paint");
    for (const activeMemberCount of [0, 1, 3]) {
      for (const groupSettings of [null, { enabled: false }, { enabled: true, settlementCurrency: "INR" }]) {
        preferences.groupSettings = groupSettings;
        const frame = GroupDashboard({ ...props, activeMemberCount });
        assert.deepEqual(geometry(frame), firstFrame);
        assert.ok(byId(frame, "group-position-placeholder"));
        assert.doesNotMatch(text(frame), /You're even|All settled/);
      }
    }
  }
});

test("known solo and non-unified groups have no unused rows during or after loading", () => {
  for (const fontScale of [1, 1.5]) {
    for (const enabled of [true, false]) {
      for (const activeMemberCount of [0, 1, 3]) {
        const { GroupDashboard } = components({
          groupSettings: { enabled, settlementCurrency: "INR" },
        }, { colors: {} }, { width: 402, fontScale });
        const props = { balances: [], currentUserId: "me", activeMemberCount };
        const pending = GroupDashboard({ ...props, loading: true });
        const loaded = GroupDashboard({ ...props, loading: false });
        const pendingRows = React.Children.toArray(pending.props.children);
        const loadedRows = React.Children.toArray(loaded.props.children);
        const expectedRows = activeMemberCount > 1 ? 1 : 0;
        assert.equal(pendingRows.length, expectedRows);
        assert.equal(loadedRows.length, expectedRows);
        assert.equal(text(loaded).includes("In one currency"), false);
        assert.equal(text(loaded).includes("You're even"), activeMemberCount > 1);
        assert.equal(text(pending).includes("You're even"), false);
      }
    }
  }
});

test("navigation unify flag predicts the header before local preferences hydrate", () => {
  for (const unifyBalances of [true, false]) {
    const preferences = { groupSettings: null };
    const { GroupDashboard } = components(preferences);
    const props = { balances: [], currentUserId: "me", activeMemberCount: 3, unifyBalances };
    const pending = GroupDashboard({ ...props, loading: true });
    preferences.groupSettings = { enabled: unifyBalances, settlementCurrency: "INR" };
    const loaded = GroupDashboard({ ...props, loading: false });
    const geometry = tree => React.Children.toArray(tree.props.children).map(row => flatten(row.props.style));
    assert.equal(geometry(pending).length, 1);
    assert.equal(geometry(loaded).length, 1);
    assert.doesNotMatch(text(pending), /You're even/);
    assert.match(text(loaded), /You're even/);
  }
});

test("cached effective currency settings take precedence over stale navigation flags", () => {
  for (const enabled of [true, false]) {
    const { GroupDashboard } = components({ groupSettings: { enabled, settlementCurrency: "INR" } });
    const props = { balances: [], currentUserId: "me", activeMemberCount: 3, unifyBalances: !enabled };
    const pending = GroupDashboard({ ...props, loading: true });
    const loaded = GroupDashboard({ ...props, loading: false });
    const geometry = tree => React.Children.toArray(tree.props.children).map(row => flatten(row.props.style));
    assert.equal(geometry(pending).length, 1);
    assert.equal(geometry(loaded).length, 1);
    assert.match(text(loaded), /You're even/);
  }
});

test("unknown-to-solo reserves during loading but leaves no empty slot once members resolve", () => {
  const props = { balances: [], currentUserId: "me", activeMemberCount: 0, unifyBalances: false };
  const { GroupDashboard } = components();
  const pending = GroupDashboard({ ...props, membersKnown: false, loading: true });
  const loaded = GroupDashboard({ ...props, membersKnown: true, loading: false });
  const rows = tree => React.Children.toArray(tree.props.children).length;
  assert.equal(rows(pending), 1);
  assert.equal(rows(loaded), 0);
  const reopened = components().GroupDashboard({ ...props, membersKnown: true, loading: false });
  assert.equal(rows(reopened), 0); // spending cards no longer occupy a slot once members resolve
});

test("a cached multi-member prediction cannot leave empty slots after membership changes", () => {
  const { GroupDashboard } = components({ groupSettings: { enabled: true, settlementCurrency: "INR" } });
  const props = { balances: [], currentUserId: "me", membersKnown: true };
  const pending = GroupDashboard({ ...props, activeMemberCount: 2, loading: true });
  const stillPending = GroupDashboard({ ...props, activeMemberCount: 1, loading: true });
  const loaded = GroupDashboard({ ...props, activeMemberCount: 1, loading: false });
  const rows = tree => React.Children.toArray(tree.props.children).length;
  assert.equal(rows(pending), 1);
  assert.equal(rows(stillPending), 1);
  assert.equal(rows(loaded), 0);
  assert.doesNotMatch(text(loaded), /In one currency|All settled/);
});

test("stale known-solo metadata does not hide real multi-member content after load", () => {
  const { GroupDashboard } = components({ groupSettings: { enabled: true, settlementCurrency: "INR" } });
  const props = { balances: [], currentUserId: "me" };
  const pending = GroupDashboard({ ...props, activeMemberCount: 1, loading: true });
  const stillPending = GroupDashboard({ ...props, activeMemberCount: 3, loading: true });
  assert.equal(React.Children.toArray(pending.props.children).length, 0);
  assert.equal(React.Children.toArray(stillPending.props.children).length, 0);
  const loaded = GroupDashboard({ ...props, activeMemberCount: 3, loading: false });
  assert.match(text(loaded), /You're even/);
  assert.doesNotMatch(text(pending), /You're even|All settled/);
});

test("App preserves unknown membership and GroupDetails resets predictions per group", () => {
  const app = readFileSync(path.join(__dirname, "../App.tsx"), "utf8");
  assert.match(app, /const groupToDisplay: GroupWithMembers = selectedGroupDetails \|\| selectedGroup;/);
  const screen = readFileSync(path.join(__dirname, "../screens/GroupDetailsScreen.tsx"), "utf8");
  assert.match(screen, /<GroupDashboard\s+key=\{group.id\}/);
  assert.match(screen, /membersKnown=\{/);
  assert.match(screen, /group\.members !== undefined/);
  assert.match(screen, /hasNonZeroBalance=\{hasNonZeroBalance\}/);
  assert.match(screen, /participants=\{participants\}/);
  assert.match(screen, /unifyBalances=\{group.unify_balances\}/);
});

test("balance summary adds only matching currencies on both sides", () => {
  const { BalancesSection } = components();
  const balances = [balance("Alice", 100), balance("Bob", 100, "INR"), balance("Cara", 20), balance("Dan", -40), balance("Eve", -60, "EUR"), balance("Frank", -10, "EUR")];
  for (const showOverallBalances of [true, false]) {
    const tree = BalancesSection({ groupBalances: [{ group_id: "g", balances }], overallBalances: showOverallBalances ? balances : [], showOverallBalances, defaultCurrency: "USD", loading: false });
    const owed = text(byId(tree, "balances-summary-owed"));
    const owe = text(byId(tree, "balances-summary-owe"));
    assert.match(owed, /\$120/);
    assert.match(owed, /₹100/);
    assert.match(owe, /\$40/);
    assert.match(owe, /€70/);
    assert.doesNotMatch(owed + owe, /220(?:\.00)?|110(?:\.00)?/);
  }
});
test("balance summary preserves already-converted currency and default zero", () => {
  const tree = components().BalancesSection({ groupBalances: [], overallBalances: [balance("Alice", 110), balance("Bob", 20)], defaultCurrency: "USD", loading: false });
  assert.equal(text(byId(tree, "balances-summary-owed")), "$130");
  assert.equal(text(byId(tree, "balances-summary-owe")), "$0");
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
test("dashboard prefers onBalancePress over onSettlePress for the person row", () => {
  let breakdown = null;
  let settled = null;
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], {
    onBalancePress: (row) => { breakdown = row; },
    onSettlePress: (row) => { settled = row; },
  });
  const rows = settlementRows(tree);
  assert.equal(rows.length, 1);
  rows[0].props.onPress();
  assert.equal(breakdown?.full_name, "Alice");
  assert.equal(settled, null);
  assert.match(rows[0].props.accessibilityHint, /breakdown of the expenses and payments/);
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
  assert.equal(row.props.accessibilityLabel, "Alice owes you, $50");
  // Row height lives on DenseListCard's inner body (64pt), not host style props.
  assert.equal(pressed, null);
  row.props.onPress();
  assert.equal(pressed?.full_name, "Alice");
  assert.equal(pressed?.amount, 50);
});

test("dashboard accessible settlement label includes counterparty, direction, and signed amount", () => {
  const owed = dashboard([balance("me", 50), balance("Alice", -50)], { onSettlePress: () => {} });
  assert.equal(settlementRows(owed)[0].props.accessibilityLabel, "Alice owes you, $50");
  const owe = dashboard([balance("me", -40), balance("Bob", 40)], { onSettlePress: () => {} });
  assert.equal(settlementRows(owe)[0].props.accessibilityLabel, "You owe Bob, $40");
  const eur = dashboard([
    { ...balance("me", -30, "EUR") }, balance("Cara", 30, "EUR"),
  ], { onSettlePress: () => {} });
  assert.equal(settlementRows(eur)[0].props.accessibilityLabel, "You owe Cara, €30");
});

test("dashboard settlement row layout keeps amount out of the label column", () => {
  const tree = dashboard([balance("me", 50), balance("Alice", -50)], { onSettlePress: () => {} });
  const row = settlementRows(tree)[0];
  const rowStyle = flatten(typeof row.props.style === "function" ? undefined : row.props.style);
  assert.equal(rowStyle.height, undefined);
  // App members: one line — name shrinks, "owes you" + amount do not; no caption.
  assert.match(text(row), /Alice owes you/);
  assert.equal(nodes(row).find(n => n.props?.testID === "settlement-row-presence"), undefined);
  const name = nodes(row).find(n => n.props?.testID === "settlement-row-name");
  const amount = nodes(row).find(n => n.props?.testID === "settlement-row-amount");
  const labelColumn = nodes(row).find(n => n.props?.testID === "settlement-label-column");
  const line1 = nodes(row).find(n => n.props?.testID === "settlement-row-line1");
  assert.ok(name);
  assert.ok(amount);
  assert.ok(labelColumn);
  assert.ok(line1);
  assert.equal(text(name), "Alice");
  assert.match(text(line1), /Alice owes you/);
  assert.equal(name.props.numberOfLines, 1);
  assert.equal(flatten(name.props.style).flexShrink, 1);
  assert.equal(flatten(amount.props.style).flexShrink, 0);
  assert.equal(flatten(labelColumn.props.style).flex, 1);
  assert.equal(flatten(labelColumn.props.style).minWidth, 0);
  assert.notEqual(name.props.allowFontScaling, false);
  assert.notEqual(amount.props.allowFontScaling, false);
});

test("settlement chevron stays outside the reflowing text and initials grow with text", () => {
  const tree = dashboard([balance("me", 30000), balance("Alexandria", -30000)], { onSettlePress: () => {} });
  const row = settlementRows(tree)[0];
  const children = React.Children.toArray(row.props.children);
  assert.notEqual(flatten(row.props.style).flexWrap, "wrap", "chevron must not become a separate flex line");
  const detail = children.find(n => /Alexandria owes you/.test(text(n)) && /30,000/.test(text(n)));
  assert.ok(detail, "direction and amount reflow together inside the available row width");
  assert.equal(flatten(detail.props.style).minWidth, 0);
  assert.equal(flatten(detail.props.style).flex, 1);
  assert.equal(children.at(-1).props.name, "chevron-right");
  assert.equal(children.some((n) => n?.type?.name === "PersonAvatar"), true);
  assert.equal(nodes(row).some(n => n.type === "Text" && text(n) === "AL"), false);
});

test("settlement row avatar uses the full name so initials match members", () => {
  const tree = dashboard(
    [
      { participant_id: "p-you", user_id: "me", full_name: "You", amount: 2250, currency: "INR" },
      { participant_id: "p-asha", user_id: "u-asha", full_name: "Asha Rao", amount: -2250, currency: "INR" },
    ],
    {
      participants: [
        { id: "p-you", user_id: "me", type: "member", full_name: "You" },
        { id: "p-asha", user_id: "u-asha", type: "member", full_name: "Asha Rao" },
      ],
      defaultCurrency: "INR",
    },
  );
  const row = settlementRows(tree)[0];
  const avatar = nodes(row).find((n) => n?.type?.name === "PersonAvatar");
  assert.equal(avatar.props.name, "Asha Rao");
  assert.equal(text(nodes(row).find((n) => n.props?.testID === "settlement-row-name")), "Asha");
});

test("spending cards stay off the default group page", () => {
  for (const fontScale of [1, 2]) {
    const tree = components({}, { colors: {} }, { width: 402, fontScale }).GroupDashboard({
      balances: [], currentUserId: "me", loading: false, defaultCurrency: "USD",
    });
    assert.doesNotMatch(text(tree), /My spending|Group summary/);
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
  assert.match(text(row), /\$50$/);
});

test("GroupDetailsScreen wires balanceError and gates onSettlePress for active members only", () => {
  const source = readFileSync(path.join(__dirname, "../screens/GroupDetailsScreen.tsx"), "utf8");
  assert.match(source, /error:\s*balancesError/);
  assert.match(source, /balanceError=\{\!\!balancesError\}/);
  assert.match(source, /onSettlePress=\{isActiveMember && !balancesError \? handleSettleUp : undefined\}/);
  assert.match(source, /onBalancePress=\{!balancesError \? handleBalancePress : undefined\}/);
  assert.match(source, /if\s*\(\s*!isActiveMember\s*\|\|\s*balancesError\s*\)\s*return/);
});

test("GroupDetailsScreen paints a calm placeholder instead of skeleton stacks", () => {
  const source = readFileSync(path.join(__dirname, "../screens/GroupDetailsScreen.tsx"), "utf8");
  assert.match(source, /loading=\{balancesLoading && !balancesHasData\}/);
  assert.match(source, /Loading balances…/);
  assert.match(source, /Loading transactions…/);
  assert.match(source, /refreshing=\{loadingTreatment\.showRefreshControlLoader\}/);
  assert.match(source, /loadingTreatment\.showFooterLoader/);
  assert.doesNotMatch(source, /<LedgerSkeleton|group-dashboard-skeleton|quietLoading|Loading group details/);
  assert.match(source, /clearSavedGroupMoney|rememberGroupOpen/);
});

test("App prefetchGroupData fetches balance before the first ledger page", () => {
  const source = readFileSync(path.join(__dirname, "../App.tsx"), "utf8");
  const prefetchBlock = source.match(
    /const prefetchGroupData = React\.useCallback\(\s*async \(groupId: string\) => \{[\s\S]*?\},\s*\[queryClientInstance\]\s*\)/
  );
  assert.ok(prefetchBlock, "prefetchGroupData block should exist");
  const block = prefetchBlock[0];
  assert.match(block, /fetchBalances\(groupId,\s*false\)/);
  assert.doesNotMatch(block, /fetchBalances\(groupId,\s*true\)/);
  assert.doesNotMatch(block, /include_stats|groupStats/);
  const balanceAt = block.indexOf("fetchBalances");
  const ledgerAt = block.indexOf("fetchTransactionsPage");
  assert.ok(balanceAt >= 0 && ledgerAt > balanceAt, "balance request precedes the ledger page");
  assert.match(block, /fetchSettlements\(groupId\)/);
  assert.doesNotMatch(block, /activityQueryOptions|fetchActivityPage/);
  assert.doesNotMatch(block, /fetchLatestGroupTransactionCurrency|fetchLatestGroupExpenseSplitAmong/);
  assert.match(source, /clearSavedGroupMoney/);
});

test("group details ready telemetry starts at navigation intent", () => {
  const app = readFileSync(path.join(__dirname, "../App.tsx"), "utf8");
  const screen = readFileSync(
    path.join(__dirname, "../screens/GroupDetailsScreen.tsx"),
    "utf8"
  );
  assert.match(app, /setGroupDetailsOpenStartedAtMs\(Date\.now\(\)\)/);
  assert.match(app, /openStartedAtMs=\{groupDetailsOpenStartedAtMs/);
  assert.match(screen, /resolveGroupDetailsReadyTiming/);
  assert.match(screen, /from_cache: timing\.from_cache/);
  assert.match(screen, /cache_status: timing\.cache_status/);
  // Dashboard / list must not wait on GET /groups/:id when list row is present.
  assert.match(screen, /balancesLoading,/);
  assert.doesNotMatch(screen, /includeStats:\s*true/);
  assert.doesNotMatch(
    screen,
    /balancesLoading:\s*groupLoading \|\| balancesLoading/
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
