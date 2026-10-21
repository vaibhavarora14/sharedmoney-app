const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

function loadSettlementFormScreen(theme = { colors: { primary: "#1F5EFF", primaryContainer: "#DCE6FF", onPrimaryContainer: "#123A99", surfaceVariant: "#EEF2F7", surface: "#fff", onSurface: "#17202A", onSurfaceVariant: "#5B6776", outline: "#C9D2DF", error: "#B42318", onError: "#fff" } }) {
  const cache = new Map();
  const paper = Object.fromEntries(["ActivityIndicator", "Button", "Chip", "Dialog", "Divider", "Portal", "Surface", "Text", "TextInput", "TouchableRipple"].map(name => [name, name]));
  paper.Appbar = { Header: "Appbar.Header", Content: "Appbar.Content", Action: "Appbar.Action", BackAction: "Appbar.BackAction" };
  paper.Dialog = Object.assign("Dialog", { Title: "Dialog.Title", Content: "Dialog.Content", Actions: "Dialog.Actions" });
  paper.Portal = "Portal";
  paper.TextInput = Object.assign("TextInput", { Icon: "TextInput.Icon", Affix: "TextInput.Affix" });
  paper.useTheme = () => theme;

  let stateList = [];
  let cursor = 0;
  let effectDeps = [];
  let effectCursor = 0;
  let memoList = [];
  let memoCursor = 0;
  let alerts = [];

  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = (id) => {
      if (id === "react") return {
        ...React,
        useMemo: (fn, deps) => {
          const i = memoCursor++;
          const prev = memoList[i];
          if (!prev || !deps || deps.some((d, idx) => !Object.is(d, prev.deps[idx]))) {
            memoList[i] = { deps: deps ? [...deps] : undefined, value: fn() };
          }
          return memoList[i].value;
        },
        useState: (initial) => {
          const i = cursor++;
          if (!(i in stateList)) stateList[i] = typeof initial === "function" ? initial() : initial;
          return [stateList[i], (val) => { stateList[i] = typeof val === "function" ? val(stateList[i]) : val; }];
        },
        useEffect: (fn, deps) => {
          const i = effectCursor++;
          const prev = effectDeps[i];
          const hasChanged = !prev || !deps || deps.some((d, idx) => !Object.is(d, prev[idx]));
          if (hasChanged) {
            effectDeps[i] = deps ? [...deps] : undefined;
            fn();
          }
        },
      };
      if (id === "react-native") return {
        View: "View",
        Text: "Text",
        ScrollView: "ScrollView",
        Pressable: "Pressable",
        Modal: "Modal",
        Platform: { OS: "ios" },
        KeyboardAvoidingView: "KeyboardAvoidingView",
        Alert: {
          alert: (...args) => {
            const record = [...args];
            record.title = args[0];
            record.message = args[1];
            record.buttons = args[2];
            alerts.push(record);
          },
        },
        StyleSheet: { create: styles => styles, hairlineWidth: 1 },
      };
      if (id === "react-native-paper") return paper;
      if (id === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
      if (id === "@react-native-community/datetimepicker") return "DateTimePicker";
      if (id.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filename), id);
        return load(existsSync(resolved) ? resolved : `${resolved}.ts`);
      }
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }

  const Screen = load(path.join(__dirname, "../screens/SettlementFormScreen.tsx")).SettlementFormScreen;

  const renderScreen = (props) => {
    stateList = [];
    cursor = 0;
    effectDeps = [];
    effectCursor = 0;
    memoList = [];
    memoCursor = 0;
    alerts = [];
    Screen(props);
    cursor = 0;
    effectCursor = 0;
    memoCursor = 0;
    return Screen(props);
  };

  const createSession = (props) => {
    stateList = [];
    cursor = 0;
    effectDeps = [];
    effectCursor = 0;
    memoList = [];
    memoCursor = 0;
    alerts = [];
    Screen(props);
    cursor = 0;
    effectCursor = 0;
    memoCursor = 0;
    let currentTree = Screen(props);
    return {
      get tree() {
        return currentTree;
      },
      render() {
        cursor = 0;
        effectCursor = 0;
        memoCursor = 0;
        currentTree = Screen(props);
        return currentTree;
      },
      alerts,
      props,
    };
  };

  return Object.assign(renderScreen, { createSession });
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
  const result = nodes(tree).find(node => node.props?.testID === id);
  assert.ok(result, `Expected element with testID="${id}"`);
  return result;
}

const SettlementForm = loadSettlementFormScreen();

test("manual creation mode renders fixed You payer and wrapping To participant chips with fallback names", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice Smith", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: null, email: "bob@example.com" },
    { user_id: "u_charlie", participant_id: "p_charlie", full_name: "Charlie", email: "charlie@example.com" },
  ];

  const tree = SettlementForm({
    visible: true,
    balance: null,
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onDismiss: () => {},
  });

  // Fixed From: You
  const fromInput = byId(tree, "settlement-from-you");
  assert.equal(fromInput.props.value, "You");
  assert.equal(fromInput.props.editable, false);

  // To selector uses Chip components inside wrapping container
  const bobChip = byId(tree, "settlement-to-p_bob");
  const charlieChip = byId(tree, "settlement-to-p_charlie");
  assert.equal(bobChip.type, "Chip");
  assert.equal(charlieChip.type, "Chip");
  assert.equal(bobChip.props.showSelectedCheck, true);

  // Email prefix fallback: bob@example.com -> bob
  assert.match(text(bobChip), /bob/);
  assert.match(text(charlieChip), /Charlie/);

  // Check wrapping style: parent has flexDirection row and flexWrap wrap, not a horizontal ScrollView
  const parent = nodes(tree).find(n => n.props?.children && React.Children.toArray(n.props.children).some(c => c?.props?.testID === "settlement-to-p_bob"));
  assert.ok(parent);
  assert.equal(parent.props.style?.flexWrap, "wrap");
  assert.equal(parent.props.style?.flexDirection, "row");
});

test("duplicate participant names are disambiguated with email/id", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alex", email: "alex1@example.com" },
    { user_id: "u_alex2", participant_id: "p_alex2", full_name: "Alex", email: "alex2@example.com" },
  ];

  const tree = SettlementForm({
    visible: true,
    balance: null,
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onDismiss: () => {},
  });

  const chip = byId(tree, "settlement-to-p_alex2");
  // Alex should be disambiguated with alex2@example.com
  assert.match(text(chip), /Alex · alex2@example\.com/);
});

test("edit mode provides selectable From and To single-select chips preserving reversibility", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob", email: "bob@example.com" },
    { user_id: "u_charlie", participant_id: "p_charlie", full_name: "Charlie", email: "charlie@example.com" },
  ];

  const settlement = {
    id: "s1",
    group_id: "g1",
    from_participant_id: "p_bob",
    to_participant_id: "p_me",
    amount: 75,
    currency: "USD",
    created_at: "2026-09-18T10:00:00Z",
  };

  const tree = SettlementForm({
    visible: true,
    balance: null,
    settlement,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onUpdate: async () => {},
    onDismiss: () => {},
  });

  // From chips
  const fromBob = byId(tree, "settlement-from-p_bob");
  const fromMe = byId(tree, "settlement-from-p_me");
  assert.equal(fromBob.props.showSelectedCheck, true);

  // Reversibility: opposite-side participants must NOT be disabled so payments can be reversed
  const toBob = byId(tree, "settlement-to-p_bob");
  const toMe = byId(tree, "settlement-to-p_me");
  assert.equal(Boolean(toBob.props.disabled), false);
  assert.equal(Boolean(fromMe.props.disabled), false);

  // Current user label has (You)
  assert.match(text(fromMe), /Alice \(You\)/);
  assert.match(text(toMe), /Alice \(You\)/);
});

test("obligation mode fixes parties and does not expose participant selectors", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob", email: "bob@example.com" },
  ];

  const balance = {
    user_id: "u_bob",
    participant_id: "p_bob",
    full_name: "Bob",
    amount: 50, // Bob owes You
    currency: "USD",
  };

  const tree = SettlementForm({
    visible: true,
    balance,
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onDismiss: () => {},
  });

  // No From or To chip selectors in obligation mode
  assert.equal(nodes(tree).some(n => typeof n.props?.testID === "string" && n.props.testID.startsWith("settlement-from-")), false);
  assert.equal(nodes(tree).some(n => typeof n.props?.testID === "string" && n.props.testID.startsWith("settlement-to-")), false);

  // Header displays Bob paid you (lowercase you mid-sentence)
  assert.match(text(tree), /Bob\s*paid\s*you/);
});

test("obligation header uses email local-part and grouped whole-amount prefill", async () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_diana", participant_id: "p_diana", full_name: null, email: "diana@test.com" },
  ];

  const balance = {
    user_id: "u_diana",
    participant_id: "p_diana",
    full_name: null,
    email: "diana@test.com",
    amount: 30000, // Diana owes you
    currency: "INR",
  };

  const saveCalls = [];
  const session = SettlementForm.createSession({
    visible: true,
    balance,
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async (data) => {
      saveCalls.push(data);
    },
    onDismiss: () => {},
  });

  assert.match(text(session.tree), /diana\s*paid\s*you/);
  assert.doesNotMatch(text(session.tree), /diana@test\.com/);
  assert.doesNotMatch(text(session.tree), /paid\s*You/);

  const amountInput = byId(session.tree, "settlement-amount-input");
  assert.equal(amountInput.props.value, "30,000");

  await byId(session.tree, "settlement-save-button").props.onPress();
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].amount, 30000);
});

test("you-owe header is lowercase you and keeps non-zero decimals in amount", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob Smith", email: "bob@example.com" },
  ];

  const balance = {
    user_id: "u_bob",
    participant_id: "p_bob",
    full_name: "Bob Smith",
    email: "bob@example.com",
    amount: -431.2, // You owe Bob
    currency: "INR",
  };

  const tree = SettlementForm({
    visible: true,
    balance,
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onDismiss: () => {},
  });

  assert.match(text(tree), /you\s*paid\s*Bob/);
  assert.equal(byId(tree, "settlement-amount-input").props.value, "431.20");
});

test("owes-you modal shows secondary Remind under primary Record payment", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob Martinez", email: "bob@example.com" },
  ];

  const remindCalls = [];
  const shareCalls = [];
  const tree = SettlementForm({
    visible: true,
    balance: {
      user_id: "u_bob",
      participant_id: "p_bob",
      full_name: "Bob Martinez",
      amount: 50,
      currency: "USD",
    },
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onDismiss: () => {},
    remindLabel: "Remind Bob",
    remindShareAnotherWay: true,
    onRemindPress: () => remindCalls.push("remind"),
    onRemindShareAnotherWay: () => shareCalls.push("share"),
  });

  const save = byId(tree, "settlement-save-button");
  const remind = byId(tree, "settlement-remind-button");
  const shareAnother = byId(tree, "settlement-remind-share-another-way");
  assert.equal(save.props.mode, "contained");
  assert.equal(remind.props.mode, "text");
  assert.equal(remind.props.icon, "share-variant");
  assert.match(text(remind), /Remind Bob/);
  assert.equal(shareAnother.props.mode, "text");

  remind.props.onPress();
  assert.equal(remindCalls.length, 1);
  shareAnother.props.onPress();
  assert.equal(shareCalls.length, 1);
});

test("you-owe modal never shows Remind even when remind props are passed", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob", email: "bob@example.com" },
  ];

  const tree = SettlementForm({
    visible: true,
    balance: {
      user_id: "u_bob",
      participant_id: "p_bob",
      full_name: "Bob",
      amount: -40,
      currency: "USD",
    },
    settlement: null,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onDismiss: () => {},
    remindLabel: "Remind Bob",
    onRemindPress: () => {},
  });

  assert.equal(
    nodes(tree).some((n) => n.props?.testID === "settlement-remind-button"),
    false,
  );
});

test("edit mode never shows Remind", () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob", email: "bob@example.com" },
  ];

  const tree = SettlementForm({
    visible: true,
    balance: null,
    settlement: {
      id: "s1",
      group_id: "g1",
      from_participant_id: "p_bob",
      to_participant_id: "p_me",
      amount: 50,
      currency: "USD",
      created_at: "2026-09-18T10:00:00Z",
    },
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onUpdate: async () => {},
    onDismiss: () => {},
    remindLabel: "Remind Bob",
    onRemindPress: () => {},
  });

  assert.equal(
    nodes(tree).some((n) => n.props?.testID === "settlement-remind-button"),
    false,
  );
});

test("two-person settlement reversal interaction and invalid same-person save prevention", async () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob", email: "bob@example.com" },
  ];

  const settlement = {
    id: "s1",
    group_id: "g1",
    from_participant_id: "p_me",
    to_participant_id: "p_bob",
    amount: 50,
    currency: "USD",
    created_at: "2026-09-18T10:00:00Z",
  };

  const updateCalls = [];
  const session = SettlementForm.createSession({
    visible: true,
    balance: null,
    settlement,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onUpdate: async (data) => {
      updateCalls.push(data);
    },
    onDismiss: () => {},
  });

  // Initial state: Alice (p_me) is From, Bob (p_bob) is To
  const initialFromAlice = byId(session.tree, "settlement-from-p_me");
  const initialToBob = byId(session.tree, "settlement-to-p_bob");
  assert.equal(initialFromAlice.props.selected, true);
  assert.equal(initialToBob.props.selected, true);

  // Conflicting opposite-side chips must be selectable (not disabled) to allow reversing
  const fromBob = byId(session.tree, "settlement-from-p_bob");
  const toAlice = byId(session.tree, "settlement-to-p_me");
  assert.equal(Boolean(fromBob.props.disabled), false);
  assert.equal(Boolean(toAlice.props.disabled), false);

  // Step 1: Select Bob as From (intermediate same-person state: Bob -> Bob)
  fromBob.props.onPress();
  session.render();

  assert.equal(byId(session.tree, "settlement-from-p_bob").props.selected, true);
  assert.equal(byId(session.tree, "settlement-to-p_bob").props.selected, true);

  // Step 2: Attempting to save intermediate same-person must be rejected by validation
  const saveButton = byId(session.tree, "settlement-save-button");
  await saveButton.props.onPress();

  assert.equal(updateCalls.length, 0, "onUpdate must not be called when payer and receiver are the same person");
  assert.equal(session.alerts.length, 1, "Validation alert must be shown");
  assert.equal(session.alerts[0].title, "Error");
  assert.match(session.alerts[0].message, /Payer and receiver must be different people/);

  // Step 3: Select Alice as To (completing reversal to Bob -> Alice)
  const toAliceChip = byId(session.tree, "settlement-to-p_me");
  toAliceChip.props.onPress();
  session.render();

  assert.equal(byId(session.tree, "settlement-from-p_bob").props.selected, true);
  assert.equal(byId(session.tree, "settlement-to-p_me").props.selected, true);

  // Step 4: Save valid reversed settlement
  await byId(session.tree, "settlement-save-button").props.onPress();

  assert.equal(updateCalls.length, 1, "onUpdate must be called after valid reversal");
  assert.equal(updateCalls[0].id, "s1");
  assert.equal(updateCalls[0].from_participant_id, "p_bob");
  assert.equal(updateCalls[0].to_participant_id, "p_me");
  assert.equal(updateCalls[0].amount, 50);
});

test("two-person settlement reversal starting from To selector with save-time validation", async () => {
  const groupMembers = [
    { user_id: "me", participant_id: "p_me", full_name: "Alice", email: "alice@example.com" },
    { user_id: "u_bob", participant_id: "p_bob", full_name: "Bob", email: "bob@example.com" },
  ];

  const settlement = {
    id: "s2",
    group_id: "g1",
    from_participant_id: "p_bob",
    to_participant_id: "p_me",
    amount: 100,
    currency: "USD",
    created_at: "2026-09-18T10:00:00Z",
  };

  const updateCalls = [];
  const session = SettlementForm.createSession({
    visible: true,
    balance: null,
    settlement,
    groupMembers,
    currentUserId: "me",
    groupId: "g1",
    onSave: async () => {},
    onUpdate: async (data) => {
      updateCalls.push(data);
    },
    onDismiss: () => {},
  });

  // Step 1: Select Bob in To (intermediate state: Bob -> Bob)
  const toBob = byId(session.tree, "settlement-to-p_bob");
  assert.equal(Boolean(toBob.props.disabled), false);
  toBob.props.onPress();
  session.render();

  // Attempt save: must be blocked by validation
  await byId(session.tree, "settlement-save-button").props.onPress();
  assert.equal(updateCalls.length, 0, "onUpdate must not be called during intermediate same-person state");
  assert.equal(session.alerts.length, 1);
  assert.match(session.alerts[0].message, /Payer and receiver must be different people/);

  // Step 2: Select Alice in From (completing reversal to Alice -> Bob)
  const fromAlice = byId(session.tree, "settlement-from-p_me");
  assert.equal(Boolean(fromAlice.props.disabled), false);
  fromAlice.props.onPress();
  session.render();

  // Save valid reversed settlement
  await byId(session.tree, "settlement-save-button").props.onPress();
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].id, "s2");
  assert.equal(updateCalls[0].from_participant_id, "p_me");
  assert.equal(updateCalls[0].to_participant_id, "p_bob");
  assert.equal(updateCalls[0].amount, 100);
});
