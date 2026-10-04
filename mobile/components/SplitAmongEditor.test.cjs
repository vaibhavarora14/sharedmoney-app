const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

// Shallow component harness: native/Paper views are opaque boundaries. Execute
// the real editor and split/currency helpers without requiring a native runtime.
function createEditor(overrides = {}) {
  const state = [];
  let cursor = 0;
  const calls = [];
  const props = {
    participants: [
      { id: "a", full_name: "Alice", email: "alice@example.com", type: "member" },
      { id: "b", full_name: "Bob", email: "bob@example.com", type: "member" },
    ],
    selectedIds: ["a", "b"], amounts: {}, shares: {}, mode: "equal",
    totalAmount: 100, currency: "USD", areAllSelected: true,
    onToggleMember: (id) => calls.push(["member", id]),
    onToggleAll: () => calls.push(["all"]),
    onModeChange: (mode) => { props.mode = mode; calls.push(["mode", mode]); },
    onAmountChange: (id, value) => calls.push(["amount", id, value]),
    onShareChange: (id, value) => calls.push(["share", id, value]),
    onSplitRemaining: () => calls.push(["remaining"]),
    ...overrides,
  };
  const paper = Object.fromEntries(
    ["Avatar", "Button", "Chip", "IconButton", "SegmentedButtons", "Text", "TextInput", "TouchableRipple"]
      .map((name) => [name, name]),
  );
  paper.Avatar = { Text: "Avatar.Text" };
  paper.Menu = Object.assign(() => {}, { Item: "Menu.Item" });
  paper.useTheme = () => ({ colors: {} });
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (id) => {
      if (id === "react") return {
        ...React,
        useMemo: (compute) => compute(),
        useState: (initial) => {
          const index = cursor++;
          if (!(index in state)) state[index] = initial;
          return [state[index], (value) => { state[index] = value; }];
        },
      };
      if (id === "react-native") return { View: "View", StyleSheet: { create: (styles) => styles } };
      if (id === "react-native-paper") return paper;
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), `${id}.ts`));
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }
  const { SplitAmongEditor } = load(path.join(__dirname, "SplitAmongEditor.tsx"));
  return {
    props, calls,
    render() { cursor = 0; return SplitAmongEditor(props); },
  };
}

// Execute the form's real split handlers, validation, readiness and save payload
// with an in-memory onSave boundary (never a backend write).
function createForm(overrides = {}) {
  const source = readFileSync(path.join(__dirname, "../screens/TransactionFormScreen.tsx"), "utf8");
  const block = source.slice(source.indexOf("  const parsedTotalAmount ="), source.indexOf("  const filteredCurrencies ="));
  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", compile(readFileSync(path.join(__dirname, "../utils/splits.ts"), "utf8")))(module.exports);
  const saved = [];
  const scope = {
    ...module.exports, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    transaction: undefined, didDefaultSplitRef: {}, isPresetCategory: () => false,
    amount: "100", splitAmong: ["a"], allParticipantIds: ["a", "b"],
    splitMode: "equal", splitAmounts: {}, splitShares: {}, splitAmongError: "",
    description: "Dinner", date: "2026-09-16", type: "expense", category: "",
    currency: "USD", effectiveDefaultCurrency: "USD", paidBy: "a", loading: false,
    isGroupExpense: true, areAllParticipantsSelected: false,
    onSave: async (payload) => saved.push(payload),
    ...overrides,
  };
  for (const key of ["description", "amount", "date", "selectedDate", "type", "category", "useCustomCategoryInput", "currency", "paidBy", "splitMode", "splitAmong", "splitAmounts", "splitShares", "splitAmongError", "descriptionError", "amountError", "dateError", "paidByError", "loading"]) {
    scope[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      scope[key] = typeof value === "function" ? value(scope[key]) : value;
    };
  }
  const render = new Function("scope", `with (scope) { ${compile(block)}; return { handleToggleSplitMember, handleToggleAllMembers, handleSplitModeChange, handleSplitAmountChange, handleShareChange, handleSplitRemaining, handleSave, isSaveDisabled }; }`);
  const loadBlock = source.slice(source.indexOf("  const loadTransactionData ="), source.indexOf("  // Handle loading transaction data for editing"));
  const load = new Function("scope", `with (scope) { ${compile(loadBlock)}; loadTransactionData(transaction); }`);
  if (scope.transaction) load(scope);
  return { scope, saved, render: () => render({ ...scope }) };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
function byId(tree, id) {
  const node = nodes(tree).find((node) => node.props.testID === id);
  assert.ok(node, `Expected visible ${id}`);
  return node;
}
function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.Children.toArray(tree?.props?.children).map(text).join("");
}

test("bill editor keeps the creator included while reusing all expense modes", () => {
  for (const mode of ["equal", "shares", "unequal"]) {
    const editor = createEditor({ mode, requiredIds: ["a"], modeTestID: "split-bill-mode", showEqualSummary: false });
    const tree = editor.render();
    assert.equal(byId(tree, "split-mode-menu").props.anchor.props.testID, "split-bill-mode");
    assert.equal(byId(tree, "split-among-chip-alice@example.com").props.disabled, true);
    assert.equal(byId(tree, "split-among-chip-bob@example.com").props.disabled, false);
    if (mode !== "equal") assert.equal(byId(tree, "split-remove-alice@example.com").props.disabled, true);
    if (mode === "shares") assert.equal(byId(tree, "split-share-minus-alice@example.com").props.disabled, true);
    if (mode === "equal") assert.equal(text(tree).includes("Each person pays:"), false);
  }
});

test("split trigger puts expanded state on the actionable ripple, and options expose selection", () => {
  const editor = createEditor();
  let menu = byId(editor.render(), "split-mode-menu");
  assert.equal(menu.props.nativeModal, true, "split menu opts into Android accessibility isolation");
  assert.equal(menu.props.anchor.type, "TouchableRipple", "Paper Button drops expanded state on its Surface");
  assert.equal(menu.props.anchor.props.accessibilityRole, "button");
  assert.deepEqual(menu.props.anchor.props.accessibilityState, { expanded: false, disabled: false });
  menu.props.anchor.props.onPress();
  menu = byId(editor.render(), "split-mode-menu");
  assert.equal(menu.props.anchor.props.accessibilityState.expanded, true);
  assert.equal(byId(menu, "split-mode-equal").props.accessibilityState.selected, true);
  assert.equal(byId(menu, "split-mode-shares").props.accessibilityState.selected, false);
  byId(menu, "split-mode-shares").props.onPress();
  menu = byId(editor.render(), "split-mode-menu");
  assert.equal(menu.props.anchor.props.accessibilityState.expanded, false);
  assert.equal(byId(menu, "split-mode-shares").props.accessibilityState.selected, true);
});

test("header dropdown switches modes without hiding participants and dismisses on selection", () => {
  const editor = createEditor();
  for (const [mode, label] of [["unequal", "Amounts"], ["shares", "Shares"], ["equal", "Equal"]]) {
    let menu = byId(editor.render(), "split-mode-menu");
    assert.equal(menu.props.visible, false);
    menu.props.anchor.props.onPress();
    menu = byId(editor.render(), "split-mode-menu");
    assert.equal(menu.props.visible, true);
    assert.deepEqual(nodes(menu).filter((node) => node.type === "Menu.Item").map((node) => node.props.title), ["Equal", "Amounts", "Shares"]);
    byId(menu, `split-mode-${mode}`).props.onPress();
    const tree = editor.render();
    menu = byId(tree, "split-mode-menu");
    assert.equal(menu.props.visible, false);
    assert.equal(text(menu.props.anchor), label);
    assert.deepEqual(editor.calls.at(-1), ["mode", mode]);
    assert.equal(byId(menu, `split-mode-${mode}`).props.trailingIcon, "check");
    assert.equal(nodes(tree).some((node) => node.type === "Chip"), true, "selection chips stay visible in every mode");
    assert.equal(nodes(tree).some((node) => node.type === "Button" && /^(All|None|Select all)$/.test(text(node))), false);
    const inputs = nodes(tree).filter((node) => node.type === "TextInput");
    const steppers = nodes(tree).filter((node) => node.props.icon === "plus");
    assert.equal(inputs.length, mode === "unequal" ? 2 : 0);
    assert.equal(steppers.length, mode === "shares" ? 2 : 0);
  }
  let menu = byId(editor.render(), "split-mode-menu");
  menu.props.anchor.props.onPress();
  menu = byId(editor.render(), "split-mode-menu");
  menu.props.onDismiss();
  assert.equal(byId(editor.render(), "split-mode-menu").props.visible, false);
});

test("amount rows expose person and currency purpose for selected people", () => {
  const editor = createEditor({ mode: "unequal", selectedIds: ["a"], areAllSelected: false, amounts: { a: "100" } });
  const tree = editor.render();
  assert.equal(byId(tree, "split-amount-input-alice@example.com").props.accessibilityLabel, "Amount for Alice, USD");
  assert.equal(nodes(tree).some((node) => node.props.testID === "split-amount-input-bob@example.com"), false);
  assert.equal(byId(tree, "split-among-chip-bob@example.com").props.selected, false);
});

test("Amounts only includes currently selected people and preserves Equal deselection", () => {
  const editor = createEditor({
    mode: "unequal",
    selectedIds: ["a"],
    areAllSelected: false,
    amounts: { a: "20", b: "10" },
  });
  const tree = editor.render();
  assert.equal(nodes(tree).filter((node) => node.type === "TextInput").length, 1);
  assert.match(text(byId(tree, "split-remaining-label")), /Left to assign: \$80\.00/);
  const input = byId(tree, "split-amount-input-alice@example.com");
  input.props.onChangeText("$12.34");
  input.props.onChangeText("12.345");
  assert.deepEqual(editor.calls, [["amount", "a", "12.34"]]);
  byId(tree, "split-leftover-button").props.onPress();
  assert.deepEqual(editor.calls.at(-1), ["remaining"]);
  editor.props.amounts = { a: "100" };
  const updated = editor.render();
  assert.equal(nodes(updated).filter((node) => node.type === "TextInput").length, 1);
  assert.match(text(byId(updated, "split-remaining-label")), /Splits add up/);
  assert.equal(nodes(updated).some((node) => node.props.testID === "split-leftover-button"), false);
  editor.props.amounts.a = "110";
  assert.match(text(byId(editor.render(), "split-remaining-label")), /Over by: \$10\.00/);
});

test("share changes expose live resulting count and allocation while preserving limits", () => {
  const editor = createEditor({ mode: "shares", shares: { a: 3, b: 1 } });
  editor.props.onShareChange = (id, value) => { editor.props.shares[id] = value; };
  let tree = editor.render();
  const plus = nodes(tree).find(node => node.props.accessibilityLabel === "More shares for Bob");
  assert.equal(plus.props.accessibilityValue?.now, 1);
  plus.props.onPress();
  tree = editor.render();
  const live = nodes(tree).find(node => node.props.accessibilityLiveRegion === "polite" && node.props.accessibilityLabel?.startsWith("Bob,"));
  assert.ok(live);
  assert.equal(text(live), "2");
  assert.match(live.props.accessibilityLabel, /Bob, 2 shares, 40%.*\$40.00/);
  const minus = nodes(tree).find(node => node.props.accessibilityLabel === "Fewer shares for Bob");
  assert.equal(minus.props.accessibilityValue.now, 2);
  assert.equal(minus.props.accessibilityValue.min, 1);
});

test("shares only allocate among selected people and keep stepper limits", () => {
  const editor = createEditor({
    mode: "shares",
    selectedIds: ["a"],
    areAllSelected: false,
    shares: { a: 3 },
  });
  const tree = editor.render();
  assert.match(text(tree), /100% · \$100\.00/);
  assert.doesNotMatch(text(tree), /25% · \$25\.00/);
  assert.equal(nodes(tree).some((node) => node.props.accessibilityLabel === "Fewer shares for Bob"), false);
  const control = (tree, label) => nodes(tree).find((node) => node.props.accessibilityLabel === label);
  control(tree, "Fewer shares for Alice").props.onPress();
  assert.deepEqual(editor.calls, [["share", "a", 2]]);
  editor.props.shares.a = 999999;
  assert.equal(control(editor.render(), "More shares for Alice").props.disabled, true);
});

test("Shares minus at 1 share removes the person from the split", () => {
  const editor = createEditor({
    mode: "shares",
    selectedIds: ["a", "b"],
    areAllSelected: true,
    shares: { a: 1, b: 2 },
  });
  const tree = editor.render();
  const removeAlice = byId(tree, "split-share-minus-alice@example.com");
  assert.equal(removeAlice.props.disabled, false);
  assert.equal(removeAlice.props.icon, "close");
  assert.equal(removeAlice.props.accessibilityLabel, "Remove Alice from split");
  removeAlice.props.onPress();
  assert.deepEqual(editor.calls, [["member", "a"]]);
});

test("Shares minus when shareCount > 1 still decrements shares", () => {
  const editor = createEditor({
    mode: "shares",
    selectedIds: ["a", "b"],
    areAllSelected: true,
    shares: { a: 1, b: 3 },
  });
  const tree = editor.render();
  const fewerBob = byId(tree, "split-share-minus-bob@example.com");
  assert.equal(fewerBob.props.icon, "minus");
  assert.equal(fewerBob.props.accessibilityLabel, "Fewer shares for Bob");
  assert.equal(fewerBob.props.disabled, false);
  fewerBob.props.onPress();
  assert.deepEqual(editor.calls, [["share", "b", 2]]);
});

test("Shares and Amounts detail rows expose a trailing remove control", () => {
  for (const mode of ["shares", "unequal"]) {
    const editor = createEditor({
      mode,
      selectedIds: ["a", "b"],
      amounts: { a: "60", b: "40" },
      shares: { a: 1, b: 1 },
    });
    const tree = editor.render();
    const removeBob = byId(tree, "split-remove-bob@example.com");
    assert.equal(removeBob.props.icon, "account-remove");
    assert.equal(removeBob.props.accessibilityLabel, "Remove Bob from split");
    removeBob.props.onPress();
    assert.deepEqual(editor.calls.at(-1), ["member", "b"]);
  }
  const equal = createEditor({ mode: "equal" }).render();
  assert.equal(nodes(equal).some((node) => node.props.testID?.startsWith("split-remove-")), false);
});

test("empty selection hides Amounts fields and shows shared guidance", () => {
  const editor = createEditor({ selectedIds: [], mode: "unequal", areAllSelected: false });
  const tree = editor.render();
  assert.match(text(tree), /Select at least one person/);
  assert.equal(nodes(tree).filter((node) => node.type === "TextInput").length, 0);
  assert.equal(nodes(tree).some((node) => node.props.testID === "split-remaining-label"), false);
  assert.equal(nodes(tree).some((node) => node.type === "Chip"), true);
  byId(tree, "split-select-all").props.onPress();
  assert.deepEqual(editor.calls, [["all"]]);
  editor.props.mode = "equal";
  editor.props.totalAmount = null;
  assert.doesNotMatch(text(editor.render()), /Each person pays/);
});

test("disabled editor disables participants, dropdown, menu choices and amount controls", () => {
  const editor = createEditor({ disabled: true, mode: "unequal" });
  const tree = editor.render();
  const menu = byId(tree, "split-mode-menu");
  assert.equal(menu.props.visible, false);
  assert.equal(menu.props.anchor.props.disabled, true);
  for (const node of nodes(tree).filter((node) => ["Chip", "Button", "Menu.Item", "TextInput"].includes(node.type))) {
    assert.equal(node.props.disabled, true);
  }
});

test("mode switch to Amounts seeds only the Equal selection, not the full group", async () => {
  const form = createForm({ splitAmong: ["a"] });
  form.render().handleSplitModeChange("unequal");
  assert.deepEqual(form.scope.splitAmounts, { a: "100.00" });
  assert.deepEqual(form.scope.splitAmong, ["a"]);
  assert.equal(form.render().isSaveDisabled, false);
  await form.render().handleSave();
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a"]);
  assert.deepEqual(form.saved[0].splits, [{ participant_id: "a", amount: 100 }]);
});

test("deselecting someone in Amounts excludes them from save on create", async () => {
  const form = createForm({ splitAmong: ["a", "b"], splitMode: "unequal", splitAmounts: { a: "60", b: "40" } });
  form.render().handleToggleSplitMember("b");
  assert.deepEqual(form.scope.splitAmong, ["a"]);
  form.render().handleSplitAmountChange("a", "100");
  assert.equal(form.render().isSaveDisabled, false);
  await form.render().handleSave();
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a"]);
  assert.deepEqual(form.saved[0].splits, [{ participant_id: "a", amount: 100 }]);
});

test("mode switch preserves selection across Equal → Amounts → Shares", async () => {
  const form = createForm({ splitAmong: ["a"] });
  form.render().handleSplitModeChange("unequal");
  assert.deepEqual(form.scope.splitAmong, ["a"]);
  assert.deepEqual(form.scope.splitAmounts, { a: "100.00" });
  form.render().handleSplitModeChange("shares");
  assert.deepEqual(form.scope.splitAmong, ["a"]);
  assert.equal(form.render().isSaveDisabled, false);
  await form.render().handleSave();
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a"]);
  assert.equal(form.saved[0].splits, undefined);
  form.render().handleSplitModeChange("equal");
  assert.deepEqual(form.scope.splitAmong, ["a"]);
});

test("form converts selected Shares weights to Amounts without re-expanding the group", async () => {
  const form = createForm({ splitAmong: ["a"], splitShares: { a: 3 } });
  form.render().handleSplitModeChange("shares");
  assert.equal(form.render().isSaveDisabled, false);
  await form.render().handleSave();
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a"]);
  assert.equal(form.saved[0].splits, undefined);
  form.render().handleSplitModeChange("unequal");
  assert.deepEqual(form.scope.splitAmounts, { a: "100.00" });
  form.render().handleToggleSplitMember("a");
  assert.deepEqual(form.scope.splitAmong, []);
  assert.equal(form.render().isSaveDisabled, true);
});

test("empty selection after Equal None does not expand when switching to Shares", async () => {
  const form = createForm({ splitAmong: [], splitShares: { a: 3 } });
  form.render().handleSplitModeChange("shares");
  assert.deepEqual(form.scope.splitAmong, []);
  assert.equal(form.render().isSaveDisabled, true);
  await form.render().handleSave();
  assert.equal(form.saved.length, 0);
});

test("form rejects blank or zero amounts for selected people rather than silently omitting them", async () => {
  for (const b of ["", "0", "0.00", "."]) {
    const form = createForm({
      splitAmong: ["a", "b"],
      splitMode: "unequal",
      splitAmounts: { a: "100", b },
    });
    assert.equal(form.render().isSaveDisabled, true);
    await form.render().handleSave();
    assert.equal(form.saved.length, 0);
  }
});

test("form splits leftover across selected rows only, ignoring deselected drafts", async () => {
  const form = createForm({
    splitMode: "unequal",
    splitAmong: ["a", "b"],
    splitAmounts: { a: "20", b: "10", stale: "900" },
  });
  form.render().handleSplitRemaining();
  assert.deepEqual(form.scope.splitAmounts, { a: "55.00", b: "45.00", stale: "900" });
  form.render().handleToggleSplitMember("b");
  form.render().handleSplitAmountChange("a", "20");
  form.render().handleSplitRemaining();
  assert.deepEqual(form.scope.splitAmounts.a, "100.00");
  assert.deepEqual(form.scope.splitAmounts.b, "45.00");
  await form.render().handleSave();
  assert.deepEqual(form.saved[0].splits, [{ participant_id: "a", amount: 100 }]);
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a"]);
});

const subsetTransaction = {
  id: 1, description: "Dinner", amount: 100, date: "2026-09-16", type: "expense",
  currency: "USD", paid_by_participant_id: "a",
  splits: [{ participant_id: "a", amount: 30 }, { participant_id: "b", amount: 70 }],
};

test("editing an older unequal subset preserves A30/B70 with C blank on description save", async () => {
  const form = createForm({ transaction: subsetTransaction, allParticipantIds: ["a", "b", "c"] });
  assert.equal(form.scope.splitMode, "unequal");
  assert.deepEqual(form.scope.splitAmounts, { a: "30.00", b: "70.00" });
  assert.deepEqual(form.scope.splitAmong, ["a", "b"]);
  form.scope.description = "Dinner updated";
  assert.equal(form.render().isSaveDisabled, false);
  await form.render().handleSave();
  assert.equal(form.saved[0].description, "Dinner updated");
  assert.deepEqual(form.saved[0].splits, subsetTransaction.splits);
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a", "b"]);
});

test("an added participant can join an edited subset after being selected with a positive amount", async () => {
  const form = createForm({ transaction: subsetTransaction, allParticipantIds: ["a", "b", "c", "d"] });
  form.render().handleToggleSplitMember("c");
  form.render().handleSplitAmountChange("b", "60");
  form.render().handleSplitAmountChange("c", "10");
  assert.equal(form.render().isSaveDisabled, false);
  await form.render().handleSave();
  assert.deepEqual(form.saved[0].splits, [
    { participant_id: "a", amount: 30 }, { participant_id: "b", amount: 60 }, { participant_id: "c", amount: 10 },
  ]);
  assert.deepEqual(form.saved[0].split_among_participant_ids, ["a", "b", "c"]);
});

test("edit never silently omits blank, zero or invalid amounts for original participants", async () => {
  for (const b of ["", "0", "0.00", ".", "NaN", "-1"]) {
    const form = createForm({ transaction: subsetTransaction, allParticipantIds: ["a", "b", "c"] });
    form.scope.splitAmounts = { a: "100", b };
    assert.equal(form.render().isSaveDisabled, true, `b=${b}`);
    await form.render().handleSave();
    assert.equal(form.saved.length, 0, `b=${b}`);
  }
  for (const amount of [0, NaN, -1]) {
    const form = createForm({ transaction: { ...subsetTransaction, splits: [{ participant_id: "a", amount: 100 }, { participant_id: "b", amount }] } });
    assert.equal(form.render().isSaveDisabled, true);
    await form.render().handleSave();
    assert.equal(form.saved.length, 0);
  }
});

test("nonblank invalid amounts for previously excluded people also block edits once selected", async () => {
  for (const c of ["0", "0.00", ".", "NaN", "-1"]) {
    const form = createForm({ transaction: subsetTransaction, allParticipantIds: ["a", "b", "c"] });
    form.render().handleToggleSplitMember("c");
    form.scope.splitAmounts.c = c;
    assert.equal(form.render().isSaveDisabled, true);
    await form.render().handleSave();
    assert.equal(form.saved.length, 0);
  }
});

test("deselected people stay out of Amounts rows while chips remain available", () => {
  const editor = createEditor({
    mode: "unequal",
    selectedIds: ["a"],
    areAllSelected: false,
    amounts: { a: "100" },
  });
  const tree = editor.render();
  assert.equal(nodes(tree).filter((node) => node.type === "TextInput").length, 1);
  assert.equal(byId(tree, "split-among-chip-alice@example.com").props.selected, true);
  assert.equal(byId(tree, "split-among-chip-bob@example.com").props.selected, false);
  byId(tree, "split-among-chip-bob@example.com").props.onPress();
  assert.deepEqual(editor.calls, [["member", "b"]]);
});

test("invalid rounded Equal and Shares allocations explain disabled Save immediately in a live region", () => {
  for (const mode of ["equal", "shares"]) {
    const form = createForm({ amount: "0.01", splitAmong: ["a", "b"], splitMode: mode, splitShares: { a: 3, b: 1 } });
    const editor = createEditor({ totalAmount: Number(form.scope.amount), selectedIds: form.scope.splitAmong, mode: form.scope.splitMode, shares: form.scope.splitShares });
    assert.equal(form.render().isSaveDisabled, true);
    assert.equal(form.scope.splitAmongError, "", "no blocked handler was invoked");
    const live = nodes(editor.render()).find(node => node.props.accessibilityLiveRegion === "polite" && /greater than 0/.test(text(node)));
    assert.ok(live, `${mode} rounding explanation must be immediately reachable`);
    assert.match(text(live), /Increase the amount/);
    editor.props.totalAmount = 1;
    assert.doesNotMatch(text(editor.render()), /greater than 0/);
    form.scope.amount = "1";
    assert.equal(form.render().isSaveDisabled, false);
  }
});

test("Equal disables Save when one cent leaves a selected person with a rounded zero allocation", () => {
  const form = createForm({ amount: "0.01", splitAmong: ["a", "b"] });
  assert.equal(form.render().isSaveDisabled, true);
});

test("Equal validation blocks a rounded zero allocation even when Save is invoked directly", async () => {
  const form = createForm({ amount: "0.01", splitAmong: ["a", "b"] });
  await form.render().handleSave();
  assert.equal(form.saved.length, 0);
  assert.match(form.scope.splitAmongError, /greater than 0/);
  assert.match(form.scope.splitAmongError, /Increase the amount or select fewer people/);
});

for (const [amount, splitAmong] of [["0.02", ["a", "b"]], ["0.01", ["a"]]]) {
  test(`Equal saves ${amount} for ${splitAmong.length} selected people without custom splits`, async () => {
    const form = createForm({ amount, splitAmong });
    assert.equal(form.render().isSaveDisabled, false);
    await form.render().handleSave();
    assert.equal(form.saved.length, 1);
    assert.equal(form.scope.splitAmongError, "");
    assert.equal(form.saved[0].amount, Number(amount));
    assert.deepEqual(form.saved[0].split_among_participant_ids, splitAmong);
    assert.equal(form.saved[0].splits, undefined);
  });
}

test("Shares blocks a rounded zero allocation instead of sending an invalid backend split", async () => {
  const form = createForm({ amount: "0.01", splitMode: "shares", splitAmong: ["a", "b"], splitShares: { a: 3, b: 1 } });
  assert.equal(form.render().isSaveDisabled, true);
  await form.render().handleSave();
  assert.equal(form.saved.length, 0);
  assert.match(form.scope.splitAmongError, /greater than 0/);
});

test("Equal inclusion edits preserve the other modes' visible drafts", () => {
  const form = createForm({ splitAmong: ["a", "b"], splitAmounts: { a: "30", b: "70" }, splitShares: { a: 3, b: 1 }, areAllParticipantsSelected: true });
  form.render().handleToggleSplitMember("b");
  assert.deepEqual(form.scope.splitAmounts, { a: "30", b: "70" });
  assert.deepEqual(form.scope.splitShares, { a: 3, b: 1 });
  form.scope.areAllParticipantsSelected = false;
  form.render().handleToggleAllMembers();
  assert.deepEqual(form.scope.splitAmong, ["a", "b"]);
  form.scope.areAllParticipantsSelected = true;
  form.render().handleToggleAllMembers();
  assert.deepEqual(form.scope.splitAmong, []);
  form.render().handleSplitModeChange("unequal");
  assert.deepEqual(form.scope.splitAmounts, { a: "30", b: "70" });
});

test("empty Equal selection has immediate guidance and Select all recovery in every mode", () => {
  const editor = createEditor({ selectedIds: [], areAllSelected: false });
  const tree = editor.render();
  assert.match(text(tree), /Select at least one person/);
  assert.doesNotMatch(text(tree), /None|Each person pays/);
  byId(tree, "split-select-all").props.onPress();
  assert.deepEqual(editor.calls, [["all"]]);
  for (const mode of ["unequal", "shares"]) {
    editor.props.mode = mode;
    const other = editor.render();
    assert.match(text(other), /Select at least one person/);
    assert.ok(byId(other, "split-select-all"));
  }
});

test("equal split exposes participant inclusion/removal immediately", () => {
  const editor = createEditor();
  const tree = editor.render();
  for (const email of ["alice@example.com", "bob@example.com"]) {
    const chip = byId(tree, `split-among-chip-${email}`);
    assert.equal(chip.props.selected, true);
    chip.props.onPress();
  }
  assert.deepEqual(editor.calls, [["member", "a"], ["member", "b"]]);
  assert.match(text(tree), /Each person pays: \$50\.00/);
  assert.doesNotMatch(text(tree), /Adjust split|Hide options/);
  editor.props.selectedIds = ["a"];
  editor.props.areAllSelected = false;
  const updated = editor.render();
  assert.equal(byId(updated, "split-among-chip-bob@example.com").props.selected, false);
  assert.match(text(updated), /Each person pays: \$100\.00/);
  const all = nodes(updated).find((node) => node.type === "Button" && text(node) === "Select all");
  assert.ok(all);
  all.props.onPress();
  assert.deepEqual(editor.calls.at(-1), ["all"]);
});

test("Amounts and Shares expose the same selection chips as Equal", () => {
  for (const mode of ["unequal", "shares"]) {
    const editor = createEditor({ mode, selectedIds: ["a"], areAllSelected: false });
    const tree = editor.render();
    assert.equal(byId(tree, "split-among-chip-alice@example.com").props.selected, true);
    assert.equal(byId(tree, "split-among-chip-bob@example.com").props.selected, false);
    byId(tree, "split-among-chip-bob@example.com").props.onPress();
    assert.deepEqual(editor.calls.at(-1), ["member", "b"]);
  }
});
