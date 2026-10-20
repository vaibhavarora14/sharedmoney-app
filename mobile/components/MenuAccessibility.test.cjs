const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

test('opt-in nativeModal menu uses an isolated window above parent modals on every platform', () => {
  const file = path.join(path.dirname(require.resolve('react-native-paper/package.json')), 'src/components/Menu/Menu.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'MenuOverlay') declaration = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration, 'the native popup needs its own accessibility window, not just an iOS modal-view prop');
  const code = ts.transpileModule(`const ${declaration};`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  for (const OS of ['android', 'ios', 'web']) {
    const render = new Function('require', 'exports', 'Platform', 'Modal', 'Portal', `${code};return MenuOverlay;`)(require, {}, { OS }, 'NativeModal', 'Portal');
    for (const nativeModal of [true, false]) {
      const onDismiss = () => {};
      const tree = render({ nativeModal, onDismiss, children: 'existing positioned menu' });
      // nativeModal must beat nested RN Modals (e.g. Split a bill) on web and native.
      assert.equal(tree.type, nativeModal ? 'NativeModal' : 'Portal');
      assert.equal(tree.props.children, 'existing positioned menu');
      if (nativeModal) {
        assert.equal(tree.props.transparent, true);
        assert.equal(tree.props.visible, true);
        assert.equal(tree.props.statusBarTranslucent, true);
        assert.equal(tree.props.onRequestClose, onDismiss);
      }
    }
  }
});
