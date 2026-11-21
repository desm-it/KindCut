import { it, expect } from 'vitest';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { NativeJoyInlineIntent } from './native-joy-inline-intent';
function wiring() {
  const text = readFileSync(new URL('./main.ts', import.meta.url), 'utf8'),
    t = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true),
    fn = t.statements.find(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'registerNativeUserHandler',
    )!,
    map = t.statements.find(
      (n) =>
        ts.isVariableStatement(n) &&
        n.declarationList.declarations.some((d) => d.name.getText(t) === 'nativeIntentChannels'),
    )!;
  const handlers = new Map<string, (e: any, i?: unknown) => Promise<unknown>>(),
    g = new NativeJoyInlineIntent(),
    frame = {},
    event = { trusted: true, senderFrame: frame };
  let binding = 'private-A',
    calls = 0;
  const c: any = {
    nativeInlineIntents: g,
    nativeIntentBinding: () => binding,
    trustedNativeSender: (e: any) => e.trusted,
    ipcMain: { handle: (n: string, f: any) => handlers.set(n, f) },
  };
  const js = ts.transpileModule(
    map.getText(t) + '\n' + fn.getText(t) + '\nregisterNativeUserHandler;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const register = vm.runInNewContext(js, c);
  register('native-joy:job-go', async () => {
    calls++;
    return g.approve('job-go');
  });
  register('native-joy:job-status', async () => ({ phase: 'idle' }));
  return {
    g,
    frame,
    event,
    run: (e = event) => handlers.get('native-joy:job-go')!(e),
    status: () => handlers.get('native-joy:job-status')!(event),
    calls: () => calls,
    change: () => {
      binding = 'private-B';
    },
  };
}
it('actual main IPC wrapper rejects no receipt, wrong frame and replay before invoking Go', async () => {
  const x = wiring();
  await expect(x.run()).rejects.toThrow();
  expect(x.calls()).toBe(0);
  x.g.record(x.frame, 'job-go', 'private-A');
  await expect(x.run({ ...x.event, senderFrame: {} })).rejects.toThrow();
  await expect(x.run()).resolves.toBe(true);
  expect(x.calls()).toBe(1);
  await expect(x.run()).rejects.toThrow();
  expect(x.calls()).toBe(1);
});
it('actual wrapper checks trusted sender and the current private binding', async () => {
  const x = wiring();
  x.g.record(x.frame, 'job-go', 'private-A');
  await expect(x.run({ ...x.event, trusted: false })).rejects.toThrow();
  x.change();
  await expect(x.run()).rejects.toThrow();
  expect(x.calls()).toBe(0);
});
it('read-only status remains available without an approval or click', async () => {
  await expect(wiring().status()).resolves.toEqual({ phase: 'idle' });
});
function calls(
  node: ts.Node,
  predicate: (call: ts.CallExpression) => boolean,
): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  function walk(n: ts.Node) {
    if (ts.isCallExpression(n) && predicate(n)) found.push(n);
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}
const literal = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : undefined);
function assertPrivateCapture(preload: string, main: string) {
  const p = ts.createSourceFile('preload.ts', preload, ts.ScriptTarget.Latest, true),
    m = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const installs = calls(
    p,
    (c) => ts.isIdentifier(c.expression) && c.expression.text === 'installNativeIntentCapture',
  );
  expect(installs).toHaveLength(1);
  expect(
    calls(
      installs[0]!,
      (c) =>
        ts.isPropertyAccessExpression(c.expression) &&
        c.expression.name.text === 'send' &&
        literal(c.arguments[0]) === 'native-joy:trusted-click',
    ),
  ).toHaveLength(1);
  let api: ts.Node | undefined;
  function find(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'desktopApi')
      api = n.initializer;
    ts.forEachChild(n, find);
  }
  find(p);
  expect(api).toBeDefined();
  expect(
    calls(api!, (c) => c.arguments.some((a) => literal(a) === 'native-joy:trusted-click')),
  ).toHaveLength(0);
  const exposed: string[] = [];
  function properties(n: ts.Node) {
    if (ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) {
      const name = ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name) ? n.name.text : '';
      if (/approveNative|authorizeAction/.test(name)) exposed.push(name);
    }
    ts.forEachChild(n, properties);
  }
  properties(api!);
  expect(exposed).toEqual([]);
  expect(
    calls(
      m,
      (c) =>
        ts.isPropertyAccessExpression(c.expression) &&
        c.expression.name.text === 'on' &&
        literal(c.arguments[0]) === 'native-joy:trusted-click',
    ),
  ).toHaveLength(1);
  for (const name of ['registerNativeJoyIpc', 'registerNativeJoyJobIpc']) {
    const registration = calls(
      m,
      (c) => ts.isIdentifier(c.expression) && c.expression.text === name,
    );
    expect(registration).toHaveLength(1);
    const options = registration[0]!.arguments[0];
    expect(options && ts.isObjectLiteralExpression(options)).toBe(true);
    if (!options || !ts.isObjectLiteralExpression(options))
      throw Error('Expected host registration options');
    const register = options.properties.find(
      (v) => ts.isPropertyAssignment(v) && v.name.getText(m) === 'register',
    );
    expect(
      register &&
        ts.isPropertyAssignment(register) &&
        ts.isIdentifier(register.initializer) &&
        register.initializer.text === 'registerNativeUserHandler',
    ).toBe(true);
  }
}
it('keeps receipt capture private and routes hardware handlers through actual trusted registration', () => {
  assertPrivateCapture(
    readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('./main.ts', import.meta.url), 'utf8'),
  );
});
it('private-channel wiring remains valid after mechanical formatting', async () => {
  const { format } = await import('prettier');
  const preload = await format(readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'), {
    parser: 'typescript',
    singleQuote: false,
  });
  const main = await format(readFileSync(new URL('./main.ts', import.meta.url), 'utf8'), {
    parser: 'typescript',
    singleQuote: false,
  });
  assertPrivateCapture(preload, main);
});
