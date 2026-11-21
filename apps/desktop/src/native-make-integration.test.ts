import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveMakeRoute } from './native-make-route';
const text = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
function tree(source: string) {
  return ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function collect<T extends ts.Node>(node: ts.Node, predicate: (n: ts.Node) => n is T): T[] {
  const found: T[] = [];
  function walk(n: ts.Node) {
    if (predicate(n)) found.push(n);
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}
function functionNode(source: ts.SourceFile, name: string) {
  const found = collect(source, ts.isFunctionDeclaration).find((n) => n.name?.text === name);
  if (!found) throw Error(`Missing tested handler ${name}`);
  return found;
}
function attr(node: ts.JsxOpeningLikeElement, name: string) {
  return node.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}
function expression(node: ts.JsxAttribute | undefined) {
  return node?.initializer && ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
}
function assertBindings(source: string) {
  const ast = tree(source);
  const elements = collect(
    ast,
    (n): n is ts.JsxOpeningLikeElement =>
      ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n),
  );
  const modals = elements.filter((n) => n.tagName.getText(ast) === 'NativeMakeModal');
  expect(modals).toHaveLength(1);
  const modal = modals[0]!,
    visible = expression(attr(modal, 'visible')),
    sourceProp = expression(attr(modal, 'source'));
  expect(visible && ts.isIdentifier(visible)).toBe(true);
  expect(sourceProp && ts.isIdentifier(sourceProp)).toBe(true);
  if (!visible || !ts.isIdentifier(visible) || !sourceProp || !ts.isIdentifier(sourceProp))
    throw Error('Expected live state/source bindings');
  const declarations = collect(ast, ts.isVariableDeclaration);
  const state = declarations.find(
    (d) =>
      ts.isArrayBindingPattern(d.name) &&
      d.name.elements.some((e) => ts.isBindingElement(e) && e.name.getText(ast) === visible.text),
  );
  if (!state || !ts.isArrayBindingPattern(state.name)) throw Error('Missing visibility state');
  const setter = state.name.elements[1]!.getText(ast);
  const close = expression(attr(modal, 'onClose'));
  expect(close).toBeDefined();
  expect(
    collect(close!, ts.isCallExpression).some(
      (c) =>
        c.expression.getText(ast) === setter && c.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword,
    ),
  ).toBe(true);
  let parent: ts.Node | undefined = modal.parent,
    latch: ts.Node | undefined;
  while (parent) {
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      latch = parent.left;
      break;
    }
    parent = parent.parent;
  }
  expect(latch && ts.isIdentifier(latch) && latch.text !== visible.text).toBe(true);
  const returnedSource = declarations.some(
    (d) =>
      ts.isObjectBindingPattern(d.name) &&
      d.name.elements.some(
        (e) =>
          e.name.getText(ast) === sourceProp.text &&
          e.propertyName?.getText(ast) === 'getConfigurationSource',
      ),
  );
  expect(returnedSource).toBe(true);
  expect(expression(attr(modal, 'nativeMaterials'))).toBeDefined();
  expect(expression(attr(modal, 'onWorkspaceMaterialChange'))).toBeDefined();
  const start = elements.map((n) => expression(attr(n, 'onStartCut'))).find(Boolean);
  expect(start).toBeDefined();
  expect(
    collect(start!, ts.isCallExpression).some(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === 'handleOpenCutPreview',
    ),
  ).toBe(true);
}
function routeHandler(failMetadata = false) {
  const ast = tree(text),
    node = functionNode(ast, 'handleOpenCutPreview'),
    events: string[] = [];
  const context = {
    Error,
    window: {
      cricutCompanion: {
        cutterBackend: {
          get: async () => {
            events.push('preference');
            return 'auto' as const;
          },
        },
        nativeJoy: {
          getSetupStatus: async () => {
            events.push('metadata');
            if (failMetadata) throw Error('Synthetic metadata failure');
            return { enabled: true, platform: 'darwin' };
          },
        },
        slicebug: {
          createPlan: async () => {
            events.push('legacy-plan');
            throw Error('Must not invoke legacy');
          },
        },
      },
    },
    importedSvgs: [{}],
    selectedMaterialId: 218,
    insertSlots: false,
    workspaceHasCutContent: () => true,
    resolveMakeRoute,
    setCutSession: () => events.push('clear-legacy'),
    setNativeMakeEverOpened: (v: boolean) => events.push(`ever-open:${v}`),
    setNativeMakeOpen: (v: boolean) => events.push(`open:${v}`),
    setImportMessage: () => events.push('message'),
  };
  const output = ts.transpileModule(node.getText(ast) + '\nhandleOpenCutPreview;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return { events, run: vm.runInNewContext(output, context) as () => Promise<void> };
}
describe('actual main Make bindings', () => {
  it('routes native metadata before clearing any legacy state or starting a legacy plan', async () => {
    const f = routeHandler();
    await f.run();
    expect(f.events).toEqual(['preference', 'metadata', 'ever-open:true', 'open:true']);
  });
  it('stops an unknown backend without clearing an existing workflow or planning a fallback', async () => {
    const f = routeHandler(true);
    await f.run();
    expect(f.events).toEqual(['preference', 'metadata', 'message']);
  });
  it('binds one persistent modal to live source/material and an independent visibility state', () =>
    assertBindings(text));
  it('preserves the same binding assertions after mechanical formatting', async () => {
    const { format } = await import('prettier');
    assertBindings(await format(text, { parser: 'typescript', filepath: 'App.tsx' }));
  });
  it('does not mount hardware controls or job-source APIs in Settings', () => {
    const ast = tree(
      readFileSync(new URL('./components/modals/SettingsModal.tsx', import.meta.url), 'utf8'),
    );
    const elements = collect(
      ast,
      (n): n is ts.JsxOpeningLikeElement =>
        ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n),
    );
    expect(elements.some((n) => n.tagName.getText(ast) === 'NativeJoySetupPanel')).toBe(false);
    expect(
      collect(ast, ts.isIdentifier).some((n) => n.text === 'onNativeConfigurationSource'),
    ).toBe(false);
    expect(collect(ast, ts.isIdentifier).some((n) => n.text === 'onOpenNativeMake')).toBe(true);
  });
});
