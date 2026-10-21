const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

function byId(tree, id) {
  const node = nodes(tree).find((node) => node.props?.testID === id);
  assert.ok(node, `Expected ${id}`);
  return node;
}

function loadScreen(overrides = {}) {
  const state = [];
  let cursor = 0;
  const theme = {
    colors: {
      background: "#fff",
      surface: "#fff",
      surfaceVariant: "#eee",
      onSurface: "#111",
      onSurfaceVariant: "#666",
      primary: "#1F5EFF",
      error: "#B00",
      outline: "#ccc",
    },
    fonts: { labelLarge: { lineHeight: 16 } },
  };
  const paper = Object.fromEntries(
    ["Appbar", "Button", "Icon", "List", "Portal", "Surface", "Text", "TextInput"].map((name) => [name, name]),
  );
  paper.Appbar = { Header: "Header", BackAction: "Back", Content: "Content" };
  paper.List = { Item: "List.Item", Icon: "List.Icon" };
  paper.Portal = Object.assign(function Portal({ children }) {
    return React.createElement("Portal", null, children);
  }, { Host: "Portal.Host" });
  paper.Modal = "PaperModal";
  paper.useTheme = () => theme;
  paper.TextInput = "TextInput";
  paper.Button = "Button";
  paper.Surface = "Surface";
  paper.Text = "Text";
  paper.Icon = "Icon";

  const directory = {
    isLoading: true,
    isError: false,
    data: [],
    refetch: () => {},
    ...overrides.directory,
  };
  const sessionQuery = {
    isPending: !!overrides.token,
    isError: false,
    data: overrides.session ?? null,
    refetch: () => {},
    ...overrides.sessionQuery,
  };

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
      if (id === "react") {
        return {
          ...React,
          useRef: (value) => ({ current: value }),
          useEffect: () => {},
          useState: (initial) => {
            const index = cursor++;
            if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
            return [state[index], (value) => {
              state[index] = typeof value === "function" ? value(state[index]) : value;
            }];
          },
          useMemo: (fn) => fn(),
        };
      }
      if (id === "react-native") {
        return {
          View: "View",
          ScrollView: "ScrollView",
          Modal: "Modal",
          Pressable: "Pressable",
          KeyboardAvoidingView: "KeyboardAvoidingView",
          Platform: { OS: "web" },
          Share: { share: async () => {} },
          StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
        };
      }
      if (id === "react-native-paper") return paper;
      if (id === "react-native-safe-area-context") {
        return { SafeAreaView: "SafeAreaView" };
      }
      if (id === "@tanstack/react-query") {
        return {
          useQuery: () => sessionQuery,
          useQueryClient: () => ({ cancelQueries: async () => {}, setQueryData: () => {} }),
        };
      }
      if (id === "../contexts/AuthContext") return { useAuth: () => ({ user: { id: "me" } }) };
      if (id === "../hooks/useProfile") return { useProfile: () => ({ data: { full_name: "Alex", preferred_currency: "USD" } }) };
      if (id === "../hooks/useBillSplit") {
        class BillSplitNetworkError extends Error {
          constructor(message = "You're offline") {
            super(message);
            this.name = "BillSplitNetworkError";
          }
        }
        return {
          BillSplitNetworkError,
          useBillSplitPeople: () => directory,
          createBillSplit: async () => "a".repeat(64),
          readBillSplit: async () => null,
          confirmBillSplit: async () => null,
        };
      }
      if (id === "../utils/networkErrors") {
        return {
          isBenignConnectivityError: (error) =>
            Boolean(
              error &&
                (error.name === "BillSplitNetworkError" ||
                  /network|offline|Failed to fetch/i.test(String(error.message ?? ""))),
            ),
        };
      }
      if (id === "../components/Skeleton") {
        return { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" };
      }
      if (id === "../components/SplitAmongEditor") {
        return {
          SplitAmongEditor: (props) =>
            React.createElement("SplitAmongEditor", {
              ...props,
              testID: "split-among-editor",
              children: null,
            }),
        };
      }
      if (id === "../constants/layout") return { WEB_MAX_WIDTH: 720 };
      if (id === "../utils/billSplit") {
        return {
          allocateBillSplit: () => [500, 500],
          billAmountMinor: (text) => (text ? Math.round(Number(text) * 100) : null),
          billSplitUrl: (token) => `https://sharedmoney.app/split/${token}`,
          formatBillAmount: (minor, currency) => `${currency} ${(minor / 100).toFixed(2)}`,
        };
      }
      if (id === "../utils/currency") {
        return {
          CURRENCIES: [
            { code: "USD", symbol: "$", name: "US Dollar" },
            { code: "EUR", symbol: "€", name: "Euro" },
            { code: "INR", symbol: "₹", name: "Indian Rupee" },
          ],
          formatCurrency: (amount, currency) => {
            const symbol = currency === "EUR" ? "€" : currency === "INR" ? "₹" : "$";
            return `${symbol}${Number(amount).toFixed(2)}`;
          },
          getCurrencyName: (code) => code,
          getDefaultCurrency: () => "USD",
          getLocaleCurrencyCode: () => "USD",
        };
      }
      if (id === "../utils/peoplePicker") {
        return {
          existingPersonLabel: (person) => person.full_name || person.email,
          filterAndSortExistingPeople: (people) => people,
        };
      }
      if (id === "../utils/recentBillSplits") {
        return {
          rememberRecentBillSplit: async () => [],
          readLastBillSplitCurrency: async () => null,
          writeLastBillSplitCurrency: async () => {},
        };
      }
      if (id === "../utils/splits") {
        return {
          distributeRemaining: (amounts) => amounts,
          sanitizeAmountInput: (text) => text,
        };
      }
      if (id.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filename), id.endsWith(".ts") || id.endsWith(".tsx") ? id : `${id}.ts`);
        try {
          return load(resolved);
        } catch {
          return load(`${resolved}x`);
        }
      }
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }

  const { SplitBillScreen } = load(path.join(__dirname, "SplitBillScreen.tsx"));
  return {
    render(token) {
      cursor = 0;
      return SplitBillScreen({ token, onDismiss: () => {} });
    },
    openModeMenu(tree) {
      const editor = nodes(tree).find((node) => node.type === "SplitAmongEditor");
      assert.ok(editor, "expected SplitAmongEditor");
      return editor;
    },
  };
}

function expandScreen(tree, depth = 0) {
  // Shallow harness: invoke nested form/detail/skeleton function components.
  if (!tree || depth > 6) return [];
  return nodes(tree).flatMap((node) => {
    if (typeof node.type === "function" && node.type.name && node.type.name !== "SplitAmongEditor") {
      try {
        const rendered = node.type(node.props || {});
        return [node, ...expandScreen(rendered, depth + 1)];
      } catch {
        return [node];
      }
    }
    return [node];
  });
}

test("split bill modal hosts a Portal layer so the mode menu can paint above it", () => {
  const tree = loadScreen({ directory: { isLoading: false } }).render();
  const host = nodes(tree).find((node) => node.type === "Portal.Host");
  assert.ok(host, "SplitBillScreen must wrap content in Portal.Host for in-modal menus");
  assert.equal(nodes(tree).some((node) => node.type === "Modal"), true);
});

test("people directory loading uses same-size skeletons instead of a spinner", () => {
  const tree = expandScreen(loadScreen({ directory: { isLoading: true } }).render());
  assert.equal(tree.some((node) => node.type === "ActivityIndicator"), false);
  const skeleton = tree.find((node) => node.props?.testID === "split-bill-people-skeleton");
  assert.ok(skeleton, "Expected split-bill-people-skeleton");
  const rowHeight = (style) => {
    const flat = Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    return flat.height;
  };
  const rows = nodes(skeleton).filter((node) => rowHeight(node.props?.style) === 56);
  assert.equal(rows.length, 3, "skeleton reserves three List.Item-sized rows");
});

test("create CTA stays a contained pill when disabled and currency is a picker", () => {
  const tree = expandScreen(loadScreen({ directory: { isLoading: false } }).render());
  const create = tree.find((node) => node.props?.testID === "split-bill-create");
  assert.ok(create);
  assert.equal(create.props.mode, "contained");
  assert.equal(create.props.disabled, true);
  assert.equal(create.props.children, "Create & get share link");
  const createStyle = Object.assign({}, ...[create.props.style].flat(Infinity).filter(Boolean));
  assert.equal(createStyle.borderRadius, 24);
  assert.equal(createStyle.opacity, 0.45);
  assert.equal(tree.some((node) => node.props?.label === "Currency code"), false);
  const currency = tree.find((node) => node.props?.testID === "split-bill-currency");
  assert.ok(currency);
  const currencyStyle = Object.assign({}, ...[currency.props.style].flat(Infinity).filter(Boolean));
  assert.equal(currencyStyle.borderRadius, 8);
});

test("people-directory loading keeps Create label, not Creating…", () => {
  const tree = expandScreen(loadScreen({ directory: { isLoading: true } }).render());
  const create = tree.find((node) => node.props?.testID === "split-bill-create");
  assert.ok(create);
  assert.equal(create.props.children, "Create & get share link");
  assert.doesNotMatch(String(create.props.children), /Creating/);
});

test("Add by name is an inline row under search, not an outlined button", () => {
  // Seed person-input state: amount, currencyInput, currencyHydrated, showCurrencyPicker, name…
  const screen = loadScreen({ directory: { isLoading: false } });
  // First render initializes state; then set name via the TextInput onChange.
  let tree = expandScreen(screen.render());
  const input = tree.find((node) => node.props?.testID === "split-bill-person-input");
  assert.ok(input);
  input.props.onChangeText("Sam");
  tree = expandScreen(screen.render());
  const add = tree.find((node) => node.props?.testID === "split-bill-add-person");
  assert.ok(add);
  assert.equal(add.type, "Pressable");
  assert.notEqual(add.props.mode, "outlined");
  assert.match(String(nodes(add).map((n) => (typeof n === "string" ? n : n.props?.children)).flat(Infinity).join("")), /Add/);
});

test("bill details loading uses a same-size skeleton instead of a spinner", () => {
  const tree = expandScreen(loadScreen({
    token: "a".repeat(64),
    sessionQuery: { isPending: true, data: null },
  }).render("a".repeat(64)));
  assert.equal(tree.some((node) => node.type === "ActivityIndicator"), false);
  assert.ok(tree.find((node) => node.props?.testID === "split-bill-details-skeleton"));
});

test("dead bill link shows locked copy and Go to SharedMoney, not Retry", () => {
  const tree = expandScreen(loadScreen({
    token: "a".repeat(64),
    sessionQuery: { isPending: false, isError: false, data: null },
  }).render("a".repeat(64)));
  const panel = tree.find((node) => node.props?.testID === "bill-link-unavailable");
  assert.ok(panel, "expected bill-link-unavailable");
  const text = tree
    .map((node) => (typeof node.props?.children === "string" ? node.props.children : ""))
    .join(" ");
  assert.match(text, /This bill link isn’t working/);
  assert.match(text, /expired or been removed/);
  assert.ok(tree.find((node) => node.props?.testID === "bill-link-go-home"));
  assert.equal(tree.some((node) => node.props?.testID === "bill-link-retry"), false);
  assert.doesNotMatch(text, /invalid/);
  assert.doesNotMatch(text, /stack/i);
});

test("offline bill link shows You’re offline with Retry", () => {
  const tree = expandScreen(loadScreen({
    token: "a".repeat(64),
    sessionQuery: {
      isPending: false,
      isError: true,
      error: { name: "BillSplitNetworkError", message: "You're offline" },
      data: null,
      refetch: () => {},
    },
  }).render("a".repeat(64)));
  assert.ok(tree.find((node) => node.props?.testID === "bill-link-offline"));
  assert.ok(tree.find((node) => node.props?.testID === "bill-link-retry"));
  const text = tree
    .map((node) => (typeof node.props?.children === "string" ? node.props.children : ""))
    .join(" ");
  assert.match(text, /You’re offline|You're offline/);
});

test("create form wires the mode menu and switches Equal → Shares → Amounts", () => {
  // Drive the real SplitAmongEditor against the form's onModeChange wiring.
  const source = readFileSync(path.join(__dirname, "../components/SplitAmongEditor.tsx"), "utf8");
  assert.match(source, /nativeModal/);
  assert.match(source, /testID=\{`split-mode-\$\{option\.value\}`\}/);

  const calls = [];
  const paper = Object.fromEntries(
    ["Button", "Chip", "IconButton", "Icon", "Menu", "Text", "TextInput", "TouchableRipple"]
      .map((name) => [name, name]),
  );
  paper.Menu = Object.assign(() => {}, { Item: "Menu.Item" });
  paper.useTheme = () => ({ colors: {} });
  const state = [];
  let cursor = 0;
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", code)((id) => {
      if (id === "react") {
        return {
          ...React,
          useMemo: (fn) => fn(),
          useState: (initial) => {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [state[index], (value) => { state[index] = value; }];
          },
        };
      }
      if (id === "react-native") return { View: "View", StyleSheet: { create: (styles) => styles } };
      if (id === "react-native-paper") return paper;
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), `${id}.ts`));
      return require(id);
    }, module, module.exports);
    return module.exports;
  }
  const { SplitAmongEditor } = load(path.join(__dirname, "../components/SplitAmongEditor.tsx"));
  const props = {
    participants: [
      { id: "a", full_name: "Alex", type: "member" },
      { id: "b", full_name: "Bo", type: "member" },
    ],
    selectedIds: ["a", "b"],
    amounts: {},
    shares: {},
    mode: "equal",
    totalAmount: 20,
    currency: "USD",
    areAllSelected: true,
    requiredIds: ["a"],
    modeTestID: "split-bill-mode",
    showEqualSummary: false,
    onToggleMember: () => {},
    onToggleAll: () => {},
    onModeChange: (mode) => { props.mode = mode; calls.push(mode); },
    onAmountChange: () => {},
    onShareChange: () => {},
    onSplitRemaining: () => {},
  };
  const render = () => { cursor = 0; return SplitAmongEditor(props); };
  let menu = byId(render(), "split-mode-menu");
  assert.equal(menu.props.nativeModal, true);
  assert.equal(menu.props.visible, false);
  menu.props.anchor.props.onPress();
  menu = byId(render(), "split-mode-menu");
  assert.equal(menu.props.visible, true);
  byId(menu, "split-mode-shares").props.onPress();
  assert.deepEqual(calls, ["shares"]);
  menu = byId(render(), "split-mode-menu");
  assert.equal(menu.props.visible, false);
  menu.props.anchor.props.onPress();
  menu = byId(render(), "split-mode-menu");
  byId(menu, "split-mode-unequal").props.onPress();
  assert.deepEqual(calls, ["shares", "unequal"]);
});

test("splitDraftFromExpense carries the expense form currency, not a stale code", () => {
  const filename = path.join(__dirname, "SplitBillScreen.tsx");
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  // Pure helper only — stub heavy deps so transpile loads.
  new Function("require", "module", "exports", code)((id) => {
    if (id === "react" || id === "react-native" || id === "react-native-paper"
      || id === "react-native-safe-area-context" || id === "@tanstack/react-query"
      || id.startsWith("../")) {
      if (id === "react") return React;
      if (id === "react-native") {
        return {
          View: "View",
          Modal: "Modal",
          Platform: { OS: "web" },
          Pressable: "Pressable",
          ScrollView: "ScrollView",
          Share: {},
          StyleSheet: { create: (s) => s, hairlineWidth: 1 },
          KeyboardAvoidingView: "KeyboardAvoidingView",
        };
      }
      if (id === "react-native-paper") {
        return new Proxy({}, { get: (_, name) => (name === "useTheme" ? () => ({ colors: {} }) : name) });
      }
      if (id === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
      if (id === "@tanstack/react-query") return { useQuery: () => ({}), useQueryClient: () => ({}) };
      if (id === "../utils/currency") {
        return {
          CURRENCIES: [{ code: "USD", symbol: "$" }, { code: "EUR", symbol: "€" }],
          formatCurrency: (n, c) => `${c} ${n}`,
          getCurrencyName: (c) => c,
          getDefaultCurrency: () => "USD",
          getLocaleCurrencyCode: () => "USD",
        };
      }
      if (id === "../utils/recentBillSplits") {
        return {
          formatRecentBillAmount: () => "$0",
          listRecentBillSplits: async () => [],
          RECENT_BILLS_PREVIEW_COUNT: 3,
          readLastBillSplitCurrency: async () => "EUR",
          relativeBillDate: () => "",
          rememberRecentBillSplit: async () => [],
          settlementFromBillSession: () => ({ settled: false, your_net_minor: 0 }),
          updateRecentBillSettlement: async () => [],
          writeLastBillSplitCurrency: async () => {},
        };
      }
      if (id === "../utils/billSplit") {
        return {
          allocateBillSplit: () => [],
          billAmountMinor: () => null,
          billSplitUrl: () => "",
        };
      }
      if (id === "../utils/splits") {
        return { distributeRemaining: () => ({}), sanitizeAmountInput: (t) => t };
      }
      if (id === "../utils/peoplePicker") {
        return { existingPersonLabel: (p) => p.full_name, filterAndSortExistingPeople: () => [] };
      }
      if (id === "../hooks/useBillSplit") {
        return { confirmBillSplit: async () => null, createBillSplit: async () => "", readBillSplit: async () => null, useBillSplitPeople: () => ({ data: [], isLoading: false }) };
      }
      if (id === "../hooks/useProfile") return { useProfile: () => ({ data: null }) };
      if (id === "../contexts/AuthContext") return { useAuth: () => ({ user: null }) };
      if (id === "../components/Skeleton") return { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" };
      if (id === "../components/SplitAmongEditor") return { SplitAmongEditor: "SplitAmongEditor" };
      if (id === "../constants/layout") return { WEB_MAX_WIDTH: 600 };
      return {};
    }
    return require(id);
  }, module, module.exports);

  const { splitDraftFromExpense } = module.exports;
  assert.deepEqual(
    splitDraftFromExpense({ amount: "36.00", currency: "USD" }),
    { amount: "36.00", currency: "USD" },
  );
  assert.deepEqual(
    splitDraftFromExpense({ amount: " 14.25 ", currency: "eur" }),
    { amount: "14.25", currency: "EUR" },
  );
  // Last-used EUR must not appear when the expense form shows USD.
  assert.equal(splitDraftFromExpense({ amount: "36", currency: "USD" }).currency, "USD");
  assert.notEqual(splitDraftFromExpense({ amount: "36", currency: "USD" }).currency, "EUR");
  assert.equal(splitDraftFromExpense({ amount: "", currency: "USD" }).amount, undefined);
  assert.equal(splitDraftFromExpense({ amount: "10", currency: "nope" }).currency, undefined);
});

test("SplitBillFormPreview draft currency matches Add expense carry-over (USD, not EUR)", () => {
  const source = readFileSync(path.join(__dirname, "HomePolishPreviewScreen.tsx"), "utf8");
  assert.match(source, /draft=\{\{\s*amount:\s*"36\.00",\s*currency:\s*"USD"\s*\}\}/);
  assert.doesNotMatch(
    source,
    /draft=\{\{\s*amount:\s*"36\.00",\s*currency:\s*"EUR"\s*\}\}/,
  );
  const addExpense = source.slice(source.indexOf("function AddExpenseGlobalPreview"));
  assert.match(addExpense, /\$36\.00/);
});
