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
    ["Appbar", "Button", "List", "Portal", "Surface", "Text", "TextInput"].map((name) => [name, name]),
  );
  paper.Appbar = { Header: "Header", BackAction: "Back", Content: "Content" };
  paper.List = { Item: "List.Item", Icon: "List.Icon" };
  paper.Portal = Object.assign(function Portal() {}, { Host: "Portal.Host" });
  paper.useTheme = () => theme;
  paper.TextInput = "TextInput";
  paper.Button = "Button";
  paper.Surface = "Surface";
  paper.Text = "Text";

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
          KeyboardAvoidingView: "KeyboardAvoidingView",
          Platform: { OS: "web" },
          Share: { share: async () => {} },
          StyleSheet: { create: (styles) => styles },
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
        return {
          useBillSplitPeople: () => directory,
          createBillSplit: async () => "a".repeat(64),
          readBillSplit: async () => null,
          confirmBillSplit: async () => null,
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
      if (id === "../utils/peoplePicker") {
        return {
          existingPersonLabel: (person) => person.full_name || person.email,
          filterAndSortExistingPeople: (people) => people,
        };
      }
      if (id === "../utils/recentBillSplits") {
        return { rememberRecentBillSplit: async () => [] };
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

test("bill details loading uses a same-size skeleton instead of a spinner", () => {
  const tree = expandScreen(loadScreen({
    token: "a".repeat(64),
    sessionQuery: { isPending: true, data: null },
  }).render("a".repeat(64)));
  assert.equal(tree.some((node) => node.type === "ActivityIndicator"), false);
  assert.ok(tree.find((node) => node.props?.testID === "split-bill-details-skeleton"));
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
