const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');

// Exercise the native boundary: effects, preference events, and animation cleanup.
function harness() {
  let state = true;
  let listener;
  let resolvePreference;
  let removed = false;
  let starts = 0;
  let stops = 0;
  let effectIndex = 0;
  const effects = [];
  const timings = [];
  const opacity = { setValue(value) { this.value = value; } };
  const preference = new Promise(resolve => { resolvePreference = resolve; });
  const theme = { colors: { surfaceVariant: '#dee3eb' } };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.join(__dirname, 'Skeleton.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'react') return {
      ...React,
      useRef: () => ({ current: opacity }),
      useState: () => [state, value => { state = value; }],
      useEffect: (effect, deps) => {
        const index = effectIndex++;
        const previous = effects[index];
        if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        }
      },
    };
    if (id === 'react-native') return {
      View: 'View',
      AccessibilityInfo: {
        isReduceMotionEnabled: () => preference,
        addEventListener: (event, callback) => {
          assert.equal(event, 'reduceMotionChanged');
          listener = callback;
          return { remove() { removed = true; } };
        },
      },
      Animated: {
        View: 'Animated.View',
        Value: function () { return opacity; },
        timing: (_, config) => { timings.push(config); return config; },
        sequence: value => value,
        loop: () => ({ start() { starts++; }, stop() { stops++; } }),
      },
    };
    if (id === 'react-native-paper') return { useTheme: () => theme };
    return require(id);
  }, module, module.exports);
  return {
    render() { effectIndex = 0; return module.exports.SkeletonGroup({ children: 'blocks' }); },
    block: module.exports.Skeleton,
    resolve: resolvePreference,
    change: value => listener(value),
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
    metrics: () => ({ starts, stops, removed, opacity: opacity.value }),
    timings,
    theme,
  };
}

test('one accessible Loading region contains only decorative blocks in both themes', () => {
  const app = harness();
  const tree = app.render();
  assert.equal(tree.props.accessibilityLabel, 'Loading');
  assert.equal(tree.props.accessibilityRole, 'progressbar');
  assert.deepEqual(tree.props.accessibilityState, { busy: true });
  const children = tree.props.children;
  assert.equal(children.props.accessibilityElementsHidden, true);
  assert.equal(children.props.importantForAccessibility, 'no-hide-descendants');
  for (const color of ['#dee3eb', '#353d49']) {
    app.theme.colors.surfaceVariant = color;
    const block = app.block({ width: '60%', height: 18, borderRadius: 9 });
    assert.equal(block.props.accessible, false);
    assert.equal(block.props.accessibilityElementsHidden, true);
    assert.equal(block.props.importantForAccessibility, 'no-hide-descendants');
    assert.deepEqual(block.props.style, { width: '60%', height: 18, borderRadius: 9, backgroundColor: color });
  }
  app.unmount();
});

test('pulse waits for motion preference and stops immediately when reduced motion changes', async () => {
  const app = harness();
  app.render();
  assert.equal(app.metrics().starts, 0);
  app.resolve(false);
  await Promise.resolve();
  app.render();
  assert.equal(app.metrics().starts, 1);
  assert.ok(app.timings.every(config => config.useNativeDriver && config.isInteraction === false));
  app.change(true);
  app.render();
  assert.equal(app.metrics().stops, 1);
  assert.equal(app.metrics().opacity, 1);
  app.change(false);
  app.render();
  assert.equal(app.metrics().starts, 2);
  app.unmount();
  assert.equal(app.metrics().stops, 2);
  assert.equal(app.metrics().removed, true);
});

test('a late preference query cannot overwrite a newer reduced-motion event', async () => {
  const app = harness();
  app.render();
  app.change(true);
  app.resolve(false);
  await Promise.resolve();
  app.render();
  assert.equal(app.metrics().starts, 0);
  app.unmount();
});
