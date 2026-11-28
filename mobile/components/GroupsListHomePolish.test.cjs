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
        "GROUP_BALANCE_SLOT_WIDTH",
        `return (${node.initializer.arguments[0].getText(source)});`
      )({ hairlineWidth: 1 }, 152);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(styles, `expected StyleSheet.create in ${filename}`);
  return styles;
}

test("Archived, Former and New group are a muted text row at least 44pt", () => {
  const styles = loadStyles(
    path.join(__dirname, "../screens/GroupsListScreen.tsx")
  );
  assert.ok((styles.footerLine.minHeight ?? 0) >= 44);
  assert.equal(styles.footerLine.flexDirection, "row");
  assert.equal(styles.sectionAccordion, undefined);
  assert.equal(styles.permissionCard, undefined);
});

test("Archived and Former children stay compact divider rows, not cards", () => {
  const styles = loadStyles(
    path.join(__dirname, "../screens/GroupsListScreen.tsx")
  );
  assert.equal(styles.nestedGroupRow.marginLeft, undefined);
  assert.equal(styles.nestedGroupTouchable.paddingHorizontal, 14);
  assert.equal(styles.nestedGroupRow.borderBottomWidth, 1);
  assert.equal(styles.nestedGroupRow.borderRadius, undefined);
  assert.equal(styles.nestedGroupName.fontWeight, "600");
  assert.equal(styles.denseList.gap, 8);
  assert.equal(styles.groupItem.borderRadius, 14);
  assert.equal(styles.groupItem.borderBottomWidth, undefined);
  assert.equal(styles.groupItem.marginBottom, undefined);
  assert.notEqual(styles.nestedGroupRow.borderRadius, 14);
  assert.equal(styles.positionNumber.fontSize, 40);
});

test("preview mirror keeps shared disclosure inset + nested divider chrome", () => {
  const styles = loadStyles(
    path.join(__dirname, "../screens/HomePolishPreviewScreen.tsx")
  );
  assert.ok((styles.sectionAccordion.minHeight ?? 0) >= 44);
  assert.equal(styles.nestedGroupRow.marginLeft, undefined);
  assert.equal(styles.nestedGroupTouchable.paddingHorizontal, 14);
  assert.equal(styles.nestedGroupRow.borderBottomWidth, 1);
  assert.equal(styles.groupRow.borderRadius, 14);
  assert.equal(styles.groupRow.marginBottom, 9);
  assert.ok((styles.sectionDisclosureHeader.minHeight ?? 0) >= 44);
  assert.equal(styles.sectionDisclosureHeaderRow.paddingHorizontal, 14);
});

function harnessWithFormer(loading = false) {
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
    fonts: { titleMedium: { lineHeight: 24 }, bodySmall: { lineHeight: 16 } },
  };
  const active = {
    id: "g-active",
    name: "Roommates",
    description: "Utilities",
    user_status: "active",
  };
  const plain = { id: "g-plain", name: "Lunch", user_status: "active" };
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
    Avatar: { Text: "Avatar.Text", Image: "Avatar.Image", Icon: "Avatar.Icon" },
  });
  const overrides = {
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "../contexts/AuthContext": { useAuth: () => ({ user: { id: "me" } }) },
    "../hooks/useGroups": {
      useGroups: () => ({ data: loading ? [] : [active, plain, former], isLoading: loading }),
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
        activeGroups: [active, plain],
        archivedGroups: [],
        formerGroups: [former],
      }),
    },
    "../utils/sentryTelemetry": { recordSentryListCounts: () => {} },
    "../utils/groupListPerfTelemetry": {},
    "../utils/posthogAnalytics": { captureIdentifiedAnalyticsEvent: () => {} },
    "../utils/posthogEvents": { ANALYTICS_EVENTS: {} },
    "../utils/recentBillSplits": {
      listRecentBillSplits: async () => [],
      summarizeUnsettledOneTimeBills: () => null,
      RECENT_BILLS_PREVIEW_COUNT: 3,
      formatRecentBillAmount: (minor, currency) => `$${(minor / 100).toFixed(2)}`,
      relativeBillDate: () => "Today",
    },
    "../utils/balanceRowLabels": {
      balanceAmountColor: () => "#0a7",
      groupListBalanceWords: (amount, formatted) =>
        amount > 0 ? `You're owed ${formatted}` : amount < 0 ? `You owe ${formatted}` : "Even",
    },
    "../utils/currency": {
      formatCurrency: (amount, currency) => `$${Number(amount).toFixed(2)}`,
    },
    "../components/NotificationBell": { NotificationBell: "NotificationBell" },
    "../components/Skeleton": { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" },
    "./SplitBillScreen": { SplitBillScreen: "SplitBillScreen" },
    "../components/GroupBalanceBadge": { GroupBalanceBadge: "GroupBalanceBadge" },
    "../components/GroupDenseCard": {
      GroupDenseCard: (props) =>
        React.createElement("View", {
          testID: `group-card-${props.group.id}`,
        }, React.createElement("GroupBalanceBadge", { loading: props.loading })),
    },
    "../components/DenseListCard": { DenseListCard: "DenseListCard" },
    "../components/PersonAvatar": { PersonAvatar: "PersonAvatar" },
    "../utils/groupListBalanceDisplay": {
      partitionActiveGroupsBySettlement: (groups) => ({
        openGroups: groups,
        settledGroups: [],
      }),
    },
    "../utils/denseListPeople": {
      fallbackDensePerson: (key, name) => ({ key, name, avatarUrl: null }),
    },
    "../utils/denseListTokens": { DENSE_AVATAR_SIZE: 40 },
    "../components/guest/GuestChrome": {
      GuestCleanupBanner: "GuestCleanupBanner",
      GuestDeviceLine: "GuestDeviceLine",
      GuestSaveChip: "GuestSaveChip",
      GuestSnackbar: "GuestSnackbar",
    },
    "../components/QuickSettleSheet": { QuickSettleSheet: "QuickSettleSheet" },
    "../hooks/useGuestFlags": { useGuestFlags: () => ({ cleanupEnabled: false }) },
    "../hooks/useProfile": { useProfile: () => ({ data: null }) },
    "../supabase": { supabase: { from: () => ({ select: () => ({ eq: async () => ({ count: 0 }) }) }) } },
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
            Pressable: "Pressable",
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
          const hit = [resolved, `${resolved}.tsx`, `${resolved}.ts`].find((candidate) => existsSync(candidate));
          return load(hit || `${resolved}.ts`);
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
    skeleton() {
      return load(path.join(__dirname, "../screens/GroupsListScreen.tsx")).GroupsHomeSkeleton();
    },
    skeletonRows() {
      return load(path.join(__dirname, "../screens/GroupsListScreen.tsx")).GroupsHomeSkeletonRows();
    },
    setFormerExpanded(expanded) {
      // showCreateGroup, showSplitBill, splitBillToken, recentBills,
      // formerGroupsExpanded (index 4), archivedGroupsExpanded…
      state[4] = expanded;
    },
  };
}

test("Home list uses Groups header, New group text, and clearance, not a FAB", () => {
  const tree = harnessWithFormer().render();
  assert.equal(nodes(tree).some((n) => n.type === "FAB"), false);
  const header = nodes(tree).find((n) => n.type === "Content");
  assert.equal(header.props.title, "Groups");
  const action = nodes(tree).find((n) => n.props?.testID === "new-group-action");
  assert.ok(action);
  assert.equal(action.props.mode, undefined);
  assert.equal(action.props.children, "New group");
  const clearance = nodes(tree).find((n) => n.props?.testID === "home-list-clearance");
  assert.equal(flatten(clearance.props.style).height, 32);
  assert.equal(nodes(tree).some((n) => n.props?.testID === "groups-section-header"), false);
});

test("expanded Former children use compact divider rows like Archived", () => {
  const app = harnessWithFormer();
  app.setFormerExpanded(true);
  const tree = app.render();
  const accordion = nodes(tree).find(
    (n) => n.props?.testID === "former-groups-accordion"
  );
  assert.ok(accordion);
  assert.equal(accordion.props.children, "Former 1");

  const nested = nodes(tree).find(
    (n) => n.props?.testID === "nested-group-row-g-former"
  );
  assert.ok(nested, "Former children must use nested divider rows");
  assert.equal(flatten(nested.props.style).borderBottomWidth, 1);

  // Former must not reuse active Surface card chrome.
  const formerSurface = nodes(tree).find(
    (n) =>
      n.type === "Surface" &&
      nodes(n).some((c) => c.props?.testID === "group-card-g-former")
  );
  assert.equal(formerSurface, undefined);

  const activeCard = nodes(tree).find(
    (n) => n.props?.testID === "group-card-g-active"
  );
  assert.ok(activeCard);
  const activeBadge = nodes(activeCard).find(
    (n) => n.type === "GroupBalanceBadge"
  );
  assert.equal(activeBadge.props.loading, true);
});

test("Home with groups has no Split CTA or Recent bills; only Groups header", () => {
  const tree = harnessWithFormer().render();
  assert.equal(nodes(tree).some((n) => n.props?.testID === "split-bill-entry"), false);
  assert.equal(nodes(tree).some((n) => n.props?.testID === "recent-bills-row"), false);
  assert.equal(nodes(tree).some((n) => n.props?.testID === "one-time-bills-row"), false);
  assert.ok(nodes(tree).find((n) => n.props?.testID === "groups-footer-line"));
});

test("bootstrap and initial Groups query share a calm placeholder, not a skeleton stack", () => {
  const app = harnessWithFormer(true);
  const initial = app.render();
  const bootstrap = app.skeleton();
  for (const tree of [initial, bootstrap]) {
    assert.ok(nodes(tree).find(node => node.props?.testID === "home-position-placeholder"));
    const header = nodes(tree).find(node => node.type === "Content");
    assert.equal(header.props.title, "Groups");
    assert.equal(nodes(tree).some(node => node.props?.testID === "group-skeleton-row"), false);
    assert.equal(nodes(tree).some(node => node.type === "ActivityIndicator"), false);
  }
});

test("Home with groups has no full-width Split a bill entry", () => {
  const tree = harnessWithFormer().render();
  assert.equal(nodes(tree).some(node => node.props?.testID === "split-bill-entry"), false);
  assert.equal(nodes(tree).some(node => node.props?.testID === "groups-empty-state"), false);
  assert.ok(nodes(tree).find(node => node.props?.testID === "new-group-action"));
});

test("group rows drop the description and do not paint recency from cache", () => {
  const tree = harnessWithFormer().render();
  const text = nodes(tree).map((n) => n.props?.children).flat().filter((child) => typeof child === "string");
  assert.equal(text.includes("Utilities"), false);
  assert.equal(text.includes("You left"), false);
  assert.equal(nodes(tree).find(n => n.props?.testID === "group-recency-g-active"), undefined);
  assert.equal(nodes(tree).find(n => n.props?.testID === "group-subtitle-spacer-g-plain"), undefined);
});

test("Home empty state: Create a group primary + tertiary one-time split link", () => {
  const overridesPath = path.join(__dirname, "../screens/GroupsListScreen.tsx");
  // Reuse the former harness wiring but with an empty group list.
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
    fonts: { titleMedium: { lineHeight: 24 }, bodySmall: { lineHeight: 16 } },
  };
  const paper = Object.fromEntries(
    ["ActivityIndicator", "Button", "FAB", "Icon", "IconButton", "Surface", "Text", "TouchableRipple"]
      .map((key) => [key, key])
  );
  Object.assign(paper, {
    useTheme: () => theme,
    Appbar: { Header: "Header", Content: "Content" },
    Avatar: { Text: "Avatar.Text", Image: "Avatar.Image", Icon: "Avatar.Icon" },
  });
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(overridesPath, "utf8"), {
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
            return [state[index], (value) => {
              state[index] = typeof value === "function" ? value(state[index]) : value;
            }];
          },
        };
      }
      if (id === "react-native") {
        return {
          View: "View",
          ScrollView: "ScrollView",
          TouchableOpacity: "TouchableOpacity",
          InteractionManager: { runAfterInteractions: (cb) => ({ cancel: () => {}, ...(cb(), {}) }) },
          Platform: { OS: "android" },
          Pressable: "Pressable",
          useWindowDimensions: () => ({ width: 393, height: 851, fontScale: 1 }),
          StyleSheet: { create: (x) => x, flatten, hairlineWidth: 1 },
        };
      }
      if (id === "react-native-paper") return paper;
      if (id === "@tanstack/react-query") return { useQueryClient: () => ({}) };
      if (id === "../contexts/AuthContext") return { useAuth: () => ({ user: { id: "me" } }) };
      if (id === "../hooks/useGroups") return { useGroups: () => ({ data: [], isLoading: false }) };
      if (id === "../hooks/useBalances") return { useBalances: () => ({ data: { group_balances: [] }, isLoading: false }) };
      if (id === "../hooks/useNotifications") {
        return { useNotifications: () => ({}), useUpdateNotificationPreference: () => ({}) };
      }
      if (id === "../utils/featureFlags") return { isTransactionNotificationsEnabled: () => false };
      if (id === "../utils/seenGroups") {
        return { getSeenGroupIds: async () => new Set(), markGroupSeen: () => {} };
      }
      if (id === "../utils/groupListSections") {
        return { partitionGroupsBySection: () => ({ activeGroups: [], archivedGroups: [], formerGroups: [] }) };
      }
      if (id === "../utils/recentBillSplits") {
        return {
          listRecentBillSplits: async () => [],
          summarizeUnsettledOneTimeBills: () => null,
          RECENT_BILLS_PREVIEW_COUNT: 3,
          formatRecentBillAmount: () => "$0.00",
          relativeBillDate: () => "Today",
        };
      }
      if (id === "../utils/balanceRowLabels") {
        return {
          balanceAmountColor: () => "#0a7",
          groupListBalanceWords: () => "Even",
        };
      }
      if (id === "../utils/currency") {
        return { formatCurrency: (amount) => `$${Number(amount).toFixed(2)}` };
      }
      if (id === "../utils/groupsListStatus") {
        return { groupsListStatusLine: () => null };
      }
      if (id === "../utils/groupOpenCache") {
        return { rememberAllBalances: async () => {} };
      }
      if (id === "../utils/homePosition") {
        return {
          homePosition: () => ({ kind: "unknown" }),
          countGroupsWithViewerBalance: () => 0,
        };
      }
      if (id === "../utils/groupRecency") {
        return { groupRecencyLine: () => null };
      }
      if (id === "../utils/networkErrors") {
        return { isBenignConnectivityError: () => false };
      }
      if (id === "../utils/settleShareMessage") {
        return { formatShareCurrency: (amount) => `$${Number(amount).toFixed(2)}` };
      }
      if (id === "../utils/sentryTelemetry") return { recordSentryListCounts: () => {} };
      if (id === "../utils/posthogAnalytics") return { captureIdentifiedAnalyticsEvent: () => {} };
      if (id === "../utils/posthogEvents") return { ANALYTICS_EVENTS: {} };
      if (id === "../utils/errorHandling") return {};
      if (id === "../utils/errorMessages") return {};
      if (id === "../utils/logger") return {};
      if (id === "../utils/notificationPermission") return {};
      if (id === "../services/pushNotifications") return {};
      if (id === "../components/NotificationBell") return { NotificationBell: "NotificationBell" };
      if (id === "../components/Skeleton") return { Skeleton: "Skeleton", SkeletonGroup: "SkeletonGroup" };
      if (id === "../components/GroupBalanceBadge") return { GroupBalanceBadge: "GroupBalanceBadge" };
      if (id === "../components/GroupDenseCard") {
        return {
          GroupDenseCard: (props) =>
            React.createElement("View", { testID: `group-card-${props.group.id}` }),
        };
      }
      if (id === "../components/DenseListCard") return { DenseListCard: "DenseListCard" };
      if (id === "../components/PersonAvatar") return { PersonAvatar: "PersonAvatar" };
      if (id === "../utils/groupListBalanceDisplay") {
        return {
          partitionActiveGroupsBySettlement: (groups) => ({
            openGroups: groups,
            settledGroups: [],
          }),
        };
      }
      if (id === "../utils/denseListPeople") {
        return { fallbackDensePerson: (key, name) => ({ key, name, avatarUrl: null }) };
      }
      if (id === "../utils/denseListTokens") return { DENSE_AVATAR_SIZE: 40 };
      if (id === "../components/guest/GuestChrome") {
        return {
          GuestCleanupBanner: "GuestCleanupBanner",
          GuestDeviceLine: "GuestDeviceLine",
          GuestSaveChip: "GuestSaveChip",
          GuestSnackbar: "GuestSnackbar",
        };
      }
      if (id === "../components/QuickSettleSheet") return { QuickSettleSheet: "QuickSettleSheet" };
      if (id === "../hooks/useGuestFlags") return { useGuestFlags: () => ({ cleanupEnabled: false }) };
      if (id === "../hooks/useProfile") return { useProfile: () => ({ data: null }) };
      if (id === "../supabase") return { supabase: { from: () => ({ select: () => ({ eq: async () => ({ count: 0 }) }) }) } };
      if (id === "./SplitBillScreen") return { SplitBillScreen: "SplitBillScreen" };
      if (id === "./CreateGroupScreen") return { CreateGroupScreen: "CreateGroupScreen" };
      if (id.startsWith(".")) {
        const resolved = path.resolve(path.dirname(overridesPath), id);
        const hit = [resolved, `${resolved}.tsx`, `${resolved}.ts`].find((candidate) => existsSync(candidate));
        return require(hit || `${resolved}.ts`);
      }
      return require(id);
    },
    module,
    module.exports
  );
  stateIndex = 0;
  const tree = module.exports.GroupsListScreen({});
  const empty = nodes(tree).find((n) => n.props?.testID === "groups-empty-state");
  assert.ok(empty);
  assert.equal(nodes(tree).some((n) => n.props?.testID === "split-bill-entry"), false);
  const link = nodes(empty).find((n) => n.props?.testID === "home-empty-one-time-split");
  assert.ok(link);
  assert.equal(link.props.children, "Split one bill");
  assert.equal(link.type, "Text");
  assert.ok(nodes(empty).some((n) => n.props?.testID === "groups-empty-create"));
});
