const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

const flatten = (value) =>
  Object.assign({}, ...[value].flat(Infinity).filter(Boolean));

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

function loadStyles(filename) {
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let styles;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "styles" &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(source) === "StyleSheet.create"
    ) {
      styles = new Function(
        "StyleSheet",
        `return (${node.initializer.arguments[0].getText(source)});`
      )({ hairlineWidth: 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(styles, `expected StyleSheet.create in ${filename}`);
  return styles;
}

test("Former/Archived accordion hit target is at least 44pt", () => {
  const styles = loadStyles(
    path.join(__dirname, "../screens/GroupsListScreen.tsx")
  );
  assert.ok((styles.sectionAccordion.minHeight ?? 0) >= 44);
});

test("nested Archived rows are indented hairlines; Former uses active flat cards", () => {
  const styles = loadStyles(
    path.join(__dirname, "../screens/GroupsListScreen.tsx")
  );
  assert.ok(
    styles.nestedGroupRow.marginLeft >= 12 &&
      styles.nestedGroupRow.marginLeft <= 16,
    "Archived indent children ~12–16px"
  );
  assert.equal(styles.nestedGroupRow.borderBottomWidth, 1);
  assert.equal(styles.nestedGroupRow.borderRadius, undefined);
  assert.equal(styles.nestedGroupName.fontWeight, "600");
  // Active + Former cards share surface chrome; nested Archived must not.
  assert.equal(styles.groupItem.borderRadius, 14);
  assert.equal(styles.groupItem.marginBottom, 9);
  assert.notEqual(styles.nestedGroupRow.borderRadius, 14);
  assert.equal(styles.formerAccordionContent.paddingTop, 8);
});

test("preview mirror keeps Archived nested chrome + accordion minHeight", () => {
  const styles = loadStyles(
    path.join(__dirname, "../screens/HomePolishPreviewScreen.tsx")
  );
  assert.ok((styles.sectionAccordion.minHeight ?? 0) >= 44);
  assert.ok(
    styles.nestedGroupRow.marginLeft >= 12 &&
      styles.nestedGroupRow.marginLeft <= 16
  );
  assert.equal(styles.nestedGroupRow.borderBottomWidth, 1);
  assert.equal(styles.groupRow.borderRadius, 14);
  assert.equal(styles.groupRow.marginBottom, 9);
  assert.equal(styles.formerAccordionContent.paddingTop, 8);
});

function harnessWithFormer() {
  let stateIndex = 0;
  const state = [];
  const theme = {
    colors: {
      background: "#fff",
      surface: "#f5f5f5",
      onSurface: "#111",
      onSurfaceVariant: "#666",
      outlineVariant: "#ccc",
      primary: "#0a7",
    },
    fonts: {},
  };
  const active = {
    id: "g-active",
    name: "Roommates",
    description: "Utilities",
    user_status: "active",
  };
  const former = {
    id: "g-former",
    name: "Old flatmates",
    description: "You left",
    user_status: "left",
  };
  const paper = Object.fromEntries(
    [
      "ActivityIndicator",
      "Button",
      "FAB",
      "Icon",
      "IconButton",
      "Surface",
      "Text",
      "TouchableRipple",
    ].map((key) => [key, key])
  );
  Object.assign(paper, {
    useTheme: () => theme,
    Appbar: { Header: "Header", Content: "Content" },
    List: { Accordion: "Accordion", Icon: "ListIcon" },
  });
  const overrides = {
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "../contexts/AuthContext": { useAuth: () => ({ user: { id: "me" } }) },
    "../hooks/useGroups": {
      useGroups: () => ({ data: [active, former], isLoading: false }),
    },
    "../hooks/useBalances": {
      useBalances: () => ({
        data: {
          group_balances: [
            {
              group_id: "g-active",
              balances: [{ user_id: "me", amount: 10, currency: "USD" }],
            },
            {
              group_id: "g-former",
              balances: [{ user_id: "me", amount: -5, currency: "USD" }],
            },
          ],
        },
        isLoading: false,
      }),
    },
    "../hooks/useCurrencyPreferences": {
      useCurrencyPreferences: () => ({ rateBook: {} }),
    },
    "../hooks/useNotifications": {
      useNotifications: () => ({}),
      useUpdateNotificationPreference: () => ({}),
    },
    "../utils/featureFlags": {
      isTransactionNotificationsEnabled: () => false,
    },
    "../utils/seenGroups": {
      getSeenGroupIds: async () => new Set(["g-active", "g-former"]),
      markGroupSeen: () => {},
    },
    "../services/pushNotifications": {},
    "../utils/errorHandling": {},
    "../utils/errorMessages": {},
    "../utils/logger": {},
    "../utils/notificationPermission": {},
    "../utils/groupListSections": {
      partitionGroupsBySection: () => ({
        activeGroups: [active],
        archivedGroups: [],
        formerGroups: [former],
      }),
    },
    "../utils/sentryTelemetry": { recordSentryListCounts: () => {} },
    "../utils/groupListPerfTelemetry": {},
    "../utils/posthogAnalytics": { captureIdentifiedAnalyticsEvent: () => {} },
    "../utils/posthogEvents": { ANALYTICS_EVENTS: {} },
    "../components/NotificationBell": { NotificationBell: "NotificationBell" },
    "../components/GroupBalanceBadge": { GroupBalanceBadge: "GroupBalanceBadge" },
    "./CreateGroupScreen": { CreateGroupScreen: "CreateGroupScreen" },
  };

  function load(filename) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    new Function("require", "module", "exports", code)(
      (id) => {
        if (id === "react") {
          return {
            ...React,
            useEffect: () => {},
            useRef: (v) => ({ current: v }),
            useState: (initial) => {
              const index = stateIndex++;
              if (!(index in state)) state[index] = initial;
              return [
                state[index],
                (value) => {
                  state[index] =
                    typeof value === "function" ? value(state[index]) : value;
                },
              ];
            },
          };
        }
        if (id === "react-native") {
          return {
            View: "View",
            ScrollView: "ScrollView",
            TouchableOpacity: "TouchableOpacity",
            InteractionManager: {
              runAfterInteractions: (cb) => {
                cb();
                return { cancel: () => {} };
              },
            },
            Platform: { OS: "android" },
            useWindowDimensions: () => ({
              width: 393,
              height: 851,
              fontScale: 1,
            }),
            StyleSheet: {
              create: (x) => x,
              flatten,
              hairlineWidth: 1,
            },
          };
        }
        if (id === "react-native-paper") return paper;
        if (id in overrides) return overrides[id];
        if (id.startsWith(".")) {
          const resolved = path.resolve(path.dirname(filename), id);
          return load(existsSync(resolved) ? resolved : `${resolved}.ts`);
        }
        return require(id);
      },
      module,
      module.exports
    );
    return module.exports;
  }

  return {
    render() {
      stateIndex = 0;
      return load(
        path.join(__dirname, "../screens/GroupsListScreen.tsx")
      ).GroupsListScreen({});
    },
    setFormerExpanded(expanded) {
      // formerGroupsExpanded is the 4th useState after showCreateGroup,
      // newGroupHeight, formerGroupsExpanded — indices 0,1,2
      state[2] = expanded;
    },
  };
}

test("expanded Former children render flat Surface cards like active, not hairlines", () => {
  const app = harnessWithFormer();
  app.setFormerExpanded(true);
  const tree = app.render();
  const accordion = nodes(tree).find(
    (n) => n.props?.testID === "former-groups-accordion"
  );
  assert.ok(accordion);
  assert.ok((flatten(accordion.props.style).minHeight ?? 0) >= 44);

  // Former must not use the nested hairline wrapper reserved for Archived.
  const nested = nodes(tree).find(
    (n) => n.props?.testID === "nested-group-row-g-former"
  );
  assert.equal(nested, undefined);

  const formerCard = nodes(tree).find(
    (n) => n.props?.testID === "group-card-g-former"
  );
  assert.ok(formerCard, "Former child must render the same card touch target");
  // Walk up: card lives inside Surface with active groupItem chrome.
  const formerSurface = nodes(tree).find(
    (n) =>
      n.type === "Surface" &&
      nodes(n).some((c) => c.props?.testID === "group-card-g-former")
  );
  assert.ok(formerSurface, "Former child must be wrapped in Surface");
  assert.equal(flatten(formerSurface.props.style).borderRadius, 14);
  assert.equal(flatten(formerSurface.props.style).marginBottom, 9);

  const activeCard = nodes(tree).find(
    (n) => n.props?.testID === "group-card-g-active"
  );
  assert.ok(activeCard);
  // Active balance badge waits for deferred enablement (useEffect noop in harness).
  const activeBadge = nodes(activeCard).find(
    (n) => n.type === "GroupBalanceBadge"
  );
  assert.equal(activeBadge.props.loading, true);
});
