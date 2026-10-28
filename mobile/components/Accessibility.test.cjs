const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Evaluate real JSX attribute expressions in isolation. These contracts do not
// claim native focus/speech coverage; the Paper boundary is tested separately.
function elements(file, tag) {
  const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && (!tag || node.tagName.getText(source) === tag)) {
      const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(source), a.initializer]));
      result.push({
        source: node.getText(source),
        has: name => name in attrs,
        prop(name, scope = {}) {
          const value = attrs[name];
          if (!value) return name in attrs ? true : undefined;
          if (ts.isStringLiteral(value)) return value.text;
          return new Function(...Object.keys(scope), `return (${value.expression.getText(source)});`)(...Object.values(scope));
        },
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
const id = (file, testID) => elements(file).find(e => e.source.includes(`testID="${testID}"`));

test('Paper menu consumes Back only while visible, preventing parent form dismissal', () => {
  const file = path.join(path.dirname(require.resolve('react-native-paper/package.json')), 'src/components/Menu/Menu.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleDismiss') {
      callback = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, 'exercise the installed Paper callback registered for hardwareBackPress');
  for (const visible of [true, false]) {
    let menuDismissals = 0;
    let formDismissals = 0;
    const handleDismiss = new Function('visible', 'onDismiss', `return (${callback});`)(visible, () => menuDismissals++);
    // Native BackHandler dispatches newest listener first and stops on true.
    for (const handler of [handleDismiss, () => { formDismissals++; return true; }]) {
      if (handler()) break;
    }
    assert.equal(menuDismissals, visible ? 1 : 0);
    assert.equal(formDismissals, visible ? 0 : 1, 'dismiss popup OR form, never both');
  }
});

test('quiet expense action retains button semantics', () => {
  const action = id('components/TransactionsSection.tsx', 'empty-add-expense-anyway');
  assert.equal(action.prop('accessibilityRole'), 'button');
  assert.equal(action.prop('accessibilityLabel', { emptyCopy: { secondaryLabel: 'Add an expense first' } }), 'Add an expense first');
});

test('read-only settlement payer and expense amount have purpose labels', () => {
  const payer = id('screens/SettlementFormScreen.tsx', 'settlement-from-you');
  assert.equal(payer.prop('accessibilityLabel'), 'From (payer)');
  assert.equal(payer.prop('value'), 'You');
  assert.equal(payer.prop('editable'), false);
  const amount = id('screens/TransactionFormScreen.tsx', 'amount-input');
  assert.equal(amount.prop('accessibilityLabel', { currency: 'USD' }), 'Expense amount, USD');
});

test('validation messages are live and invalid inputs retain recovery hints', () => {
  for (const file of ['screens/TransactionFormScreen.tsx', 'screens/SettlementFormScreen.tsx']) {
    const errors = elements(file, 'Text').filter(e => e.source.includes('theme.colors.error'));
    assert.ok(errors.length >= 1);
    for (const error of errors) assert.equal(error.prop('accessibilityLiveRegion'), 'polite', error.source);
  }
  for (const [file, testID, error] of [
    ['screens/TransactionFormScreen.tsx', 'amount-input', 'amountError'],
    ['screens/TransactionFormScreen.tsx', 'description-input', 'descriptionError'],
    ['screens/SettlementFormScreen.tsx', 'settlement-amount-input', 'amountError'],
  ]) assert.equal(id(file, testID).prop('accessibilityHint', { [error]: 'Recovery instruction' }), 'Recovery instruction');
});

test('close and clear icon actions have purpose names; decorative icons are not stops', () => {
  const transaction = 'screens/TransactionFormScreen.tsx';
  const expected = ['Close payer picker', 'Close category picker', 'Close currency picker'];
  const closes = elements(transaction, 'IconButton').filter(e => e.source.includes('icon="close"'));
  assert.deepEqual(closes.map(e => e.prop('accessibilityLabel')), expected);
  const clear = elements(transaction, 'TextInput.Icon').find(e => e.prop('icon') === 'close');
  assert.equal(clear.prop('accessibilityLabel'), 'Clear custom category');
  assert.equal(id('screens/SettlementFormScreen.tsx', 'settlement-form-close').prop('accessibilityLabel'), 'Close settlement');
  for (const icon of elements(transaction, 'IconButton').filter(e => !e.has('onPress'))) {
    assert.equal(icon.prop('accessible'), false);
    assert.equal(icon.prop('importantForAccessibility'), 'no');
  }
  const payerIcon = elements('screens/SettlementFormScreen.tsx', 'TextInput.Icon').find(e => e.prop('icon') === 'account-outline');
  assert.equal(payerIcon.prop('accessible'), false);
});

test('installed Paper passes ripple state to Android Pressable and menu selection to ripple', () => {
  const React = require('react');
  const theme = { isV3: true, colors: {}, fonts: { bodyLarge: {} } };
  function load(relative, extra) {
    const filename = path.join(path.dirname(require.resolve('react-native-paper/package.json')), 'src/components', relative);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    }}).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (name in extra) return extra[name];
      if (name === 'react') return { ...React, useContext: () => ({ rippleEffectEnabled: true }) };
      if (name === 'react-native') return { Platform: { OS: 'android', Version: 35 }, View: 'View', StyleSheet: { create: x => x } };
      if (name === '../../core/theming') return { useInternalTheme: () => theme };
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unhandled Paper dependency: ${name}`);
    }, module, module.exports);
    return module.exports.default;
  }
  const Ripple = load('TouchableRipple/TouchableRipple.native.tsx', {
    './Pressable': { Pressable: 'Pressable' },
    './utils': { getTouchableRippleColors: () => ({}) },
    '../../core/settings': { SettingsContext: {} },
    '../../utils/forwardRef': { forwardRef: fn => fn },
    '../../utils/hasTouchHandler': { default: props => !!props.onPress },
  });
  const MenuItem = load('Menu/MenuItem.tsx', {
    './utils': { getContentMaxWidth: () => 280, getMenuItemColor: () => ({}), MAX_WIDTH: 280, MIN_WIDTH: 112 },
    '../Icon': { default: 'Icon' },
    '../Typography/Text': { default: 'Text' },
    '../TouchableRipple/TouchableRipple': { default: Ripple },
  });
  const onPress = () => {};
  for (const expanded of [false, true]) {
    const node = Ripple({ onPress, accessibilityRole: 'button', accessibilityLabel: 'Split method: Equal', accessibilityState: { expanded, disabled: false }, children: React.createElement('Text') });
    assert.equal(node.type, 'Pressable');
    assert.equal(node.props.onPress, onPress);
    assert.equal(node.props.accessibilityState.expanded, expanded);
    assert.equal(node.props.accessibilityLabel, 'Split method: Equal');
  }
  for (const selected of [false, true]) {
    const item = MenuItem({ title: 'Equal', onPress, disabled: false, accessibilityState: { selected } });
    const node = Ripple(item.props);
    assert.equal(node.props.accessibilityRole, 'menuitem');
    assert.deepEqual(node.props.accessibilityState, { selected, disabled: false });
    assert.equal(node.props.onPress, onPress);
  }
});

test('primary group FAB keeps an explicit name in both visual variants', () => {
  const fab = elements('screens/GroupDetailsScreen.tsx', 'FAB')[0];
  for (const preferAddPeopleFab of [false, true]) {
    assert.equal(fab.prop('accessibilityLabel', { preferAddPeopleFab }), preferAddPeopleFab ? 'Add people' : 'Add expense');
  }
});
