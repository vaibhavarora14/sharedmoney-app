const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');

// Execute real components/styles with native views and network hooks as opaque
// boundaries. These are layout contracts, NOT Android text measurement tests.
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return React.Children.toArray(tree?.props?.children).map(text).join('');
}
function harness(fontScale = 1) {
  let stateIndex = 0;
  const state = [];
  const theme = { colors: {}, fonts: {} };
  const group = { id: 'g', name: 'Weekend trip with friends', description: 'A long description that should reflow', user_status: 'active' };
  const paper = Object.fromEntries(['ActivityIndicator', 'Button', 'FAB', 'Icon', 'IconButton', 'Surface', 'Text', 'TouchableRipple'].map(key => [key, key]));
  Object.assign(paper, { useTheme: () => theme, Appbar: { Header: 'Header', Content: 'Content' }, List: { Accordion: 'Accordion', Icon: 'ListIcon' } });
  const overrides = {
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '../contexts/AuthContext': { useAuth: () => ({ user: { id: 'me' } }) },
    '../hooks/useGroups': { useGroups: () => ({ data: [group], isLoading: false }) },
    '../hooks/useBalances': { useBalances: () => ({ data: { group_balances: [] }, isLoading: false }) },
    '../hooks/useCurrencyPreferences': { useCurrencyPreferences: () => ({ rateBook: {} }) },
    '../hooks/useNotifications': { useNotifications: () => ({}), useUpdateNotificationPreference: () => ({}) },
    '../utils/featureFlags': { isTransactionNotificationsEnabled: () => false },
    '../utils/seenGroups': {},
    '../services/pushNotifications': {},
    '../utils/errorHandling': {},
    '../utils/errorMessages': {},
    '../utils/logger': {},
    '../utils/notificationPermission': {},
    '../utils/groupListSections': { partitionGroupsBySection: (groups) => ({ activeGroups: groups, archivedGroups: [], formerGroups: [] }) },
    '../utils/sentryTelemetry': { recordSentryListCounts: () => {} },
    '../utils/groupListPerfTelemetry': {},
    '../utils/posthogAnalytics': { captureIdentifiedAnalyticsEvent: () => {} },
    '../utils/posthogEvents': { ANALYTICS_EVENTS: {} },
    '../components/NotificationBell': { NotificationBell: 'NotificationBell' },
    '../components/GroupBalanceBadge': { GroupBalanceBadge: 'GroupBalanceBadge' },
    '../components/Skeleton': { Skeleton: 'Skeleton', SkeletonGroup: 'SkeletonGroup' },
    './Skeleton': { Skeleton: 'Skeleton', SkeletonGroup: 'SkeletonGroup' },
    './SplitBillScreen': { SplitBillScreen: 'SplitBillScreen' },
    './CreateGroupScreen': { CreateGroupScreen: 'CreateGroupScreen' },
    './ProfileIcon': { ProfileIcon: 'ProfileIcon' },
  };
  function load(filename) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }}).outputText;
    new Function('require', 'module', 'exports', code)(id => {
      if (id === 'react') return { ...React, useEffect: () => {}, useRef: v => ({ current: v }), useState: initial => {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      }};
      if (id === 'react-native') return {
        View: 'View', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity',
        InteractionManager: { runAfterInteractions: cb => { cb(); return { cancel: () => {} }; } },
        Platform: { OS: 'android' },
        useWindowDimensions: () => ({ width: 393, height: 851, fontScale }),
        StyleSheet: { create: x => x, flatten, hairlineWidth: 1 },
      };
      if (id === 'react-native-paper') return paper;
      if (id in overrides) return overrides[id];
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), id);
        return load(existsSync(resolved) ? resolved : `${resolved}.ts`);
      }
      return require(id);
    }, module, module.exports);
    return module.exports;
  }
  return {
    group,
    render(file, name, props = {}) {
      stateIndex = 0;
      return load(path.join(__dirname, '..', file))[name](props);
    },
  };
}

test('group ledger filters grow with text while retaining their compact minimum', () => {
  const file = path.join(__dirname, '../screens/GroupDetailsScreen.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let style;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'styles' &&
        ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'StyleSheet.create') {
      style = new Function(`return (${node.initializer.arguments[0].getText(source)});`)().filterChip;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(style, 'exercise the actual shared ledger/activity filter style');
  assert.equal(style.height, undefined, '32dp must not clip scaled Paper labels');
  assert.equal(style.minHeight, 32);
  assert.equal(style.maxHeight, undefined);
});

test('New Group uses content height, keeps its action, and reserves its measured scroll clearance', () => {
  const app = harness(2);
  const render = () => app.render('screens/GroupsListScreen.tsx', 'GroupsListScreen');
  let tree = render();
  const action = nodes(tree).find(n => n.props.testID === 'new-group-action');
  assert.ok(action, 'New Group must not use Paper FAB’s fixed 56dp content box');
  assert.equal(action.props.accessibilityLabel, 'New Group');
  assert.equal(action.props.accessibilityRole, 'button');
  assert.match(text(action), /New Group/);
  const content = action.props.children;
  assert.equal(flatten(content.props.style).height, undefined);
  assert.equal(flatten(content.props.style).minHeight, 56);
  const label = nodes(action).find(n => n.type === 'Text');
  assert.equal(flatten(label.props.style).flexShrink, 1);
  assert.equal(label.props.numberOfLines, undefined);
  assert.notEqual(label.props.allowFontScaling, false);
  assert.equal(label.props.maxFontSizeMultiplier, undefined);
  const surface = nodes(tree).find(n => n.props.testID === 'new-group-surface');
  assert.equal(flatten(surface.props.style).maxWidth, '100%');
  surface.props.onLayout({ nativeEvent: { layout: { height: 112 } } });
  tree = render();
  const spacer = nodes(tree).find(n => n.props.testID === 'new-group-clearance');
  assert.equal(flatten(spacer.props.style).height, 136);
  action.props.onPress();
  assert.equal(nodes(render()).find(n => n.type === 'CreateGroupScreen').props.visible, true);
});

test('bottom navigation grows with its labels and notification badge instead of fixing their heights', () => {
  const app = harness(2);
  const tree = app.render('components/BottomNavBar.tsx', 'BottomNavBar', { currentRoute: 'groups', settlementsCount: 12 });
  const content = tree.props.children;
  const style = flatten(content.props.style);
  assert.equal(style.height, undefined, '80dp is a minimum, not a ceiling');
  assert.equal(style.minHeight, 80);
  assert.equal(style.paddingVertical, undefined, 'padding belongs inside the touch targets, not around them');
  for (const tab of React.Children.toArray(content.props.children)) {
    assert.equal(flatten(tab.props.children.props.style).paddingVertical, 14, '32dp icon + 4dp gap + 16dp label + padding retains the ordinary 80dp nav');
  }
  for (const label of nodes(tree).filter(n => n.type === 'Text')) {
    assert.equal(label.props.numberOfLines, undefined);
    assert.notEqual(label.props.allowFontScaling, false);
    assert.equal(label.props.maxFontSizeMultiplier, undefined);
    assert.equal(flatten(label.props.style).height, undefined);
  }
  const badge = nodes(tree).find(n => n.props.testID === 'settlements-tab-badge');
  assert.equal(flatten(badge.props.style).height, undefined);
  assert.equal(flatten(badge.props.style).minHeight, 16);
});

test('group rows retain compact normal layout and reflow enlarged title, description and status', () => {
  for (const fontScale of [1, 2]) {
    const app = harness(fontScale);
    const tree = app.render('screens/GroupsListScreen.tsx', 'GroupsListScreen');
    const card = nodes(tree).find(n => n.props.testID === 'group-card-g');
    const title = nodes(card).find(n => n.type === 'Text' && text(n) === app.group.name);
    const description = nodes(card).find(n => n.type === 'Text' && text(n) === app.group.description);
    assert.equal(flatten(card.props.style).flexDirection, fontScale === 1 ? 'row' : 'column');
    assert.equal(title.props.numberOfLines, fontScale === 1 ? 1 : undefined);
    assert.equal(description.props.numberOfLines, fontScale === 1 ? 1 : undefined);
    for (const node of [title, description]) {
      assert.notEqual(node.props.allowFontScaling, false);
      assert.equal(node.props.maxFontSizeMultiplier, undefined);
    }
    const badge = nodes(card).find(n => n.type === 'GroupBalanceBadge');
    if (fontScale === 2) assert.equal(flatten(badge.props.style).alignSelf, 'flex-start');
    for (const balances of [[], [{ user_id: 'me', amount: 123456.78, currency: 'USD' }], [{ user_id: 'me', amount: -42, currency: 'EUR' }]]) {
      const renderedBadge = app.render('components/GroupBalanceBadge.tsx', 'GroupBalanceBadge', {
        ...badge.props, currentUserId: 'me', loading: false, balanceData: { group_id: 'g', balances },
      });
      for (const node of nodes(renderedBadge)) {
        assert.equal(flatten(node.props.style).height, undefined, 'status remains content-sized');
        assert.equal(node.props.numberOfLines, undefined);
        assert.notEqual(node.props.allowFontScaling, false);
        assert.equal(node.props.maxFontSizeMultiplier, undefined);
      }
      assert.ok(text(renderedBadge).length > 0);
      if (balances.length === 0) {
        assert.match(text(renderedBadge), /Even/);
        assert.doesNotMatch(text(renderedBadge), /Settled/i);
      }
    }
  }
});
