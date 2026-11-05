import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const stubPath = join(root, "scripts/smoke/vscode-stub.cjs");

// 必须在 require 打包产物之前把 "vscode" 指到桩上。
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return require(stubPath);
  return originalLoad.call(this, request, parent, isMain);
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stub = require(stubPath);
const {
  __created: created,
  __createWebviewView: createWebviewView,
  __createMemento: createMemento,
  Uri,
  Disposable,
} = stub;

function loadExtension(entry) {
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

function setup(entry = join(root, "dist/extension.js")) {
  assert.ok(existsSync(entry), `找不到 ${entry}，先运行 pnpm compile`);
  const context = {
    subscriptions: [],
    extensionUri: Uri.file(root),
    extension: { packageJSON: pkg },
    globalState: createMemento(),
    secrets: {
      get: async () => undefined,
      store: async () => {},
      onDidChange: () => new Disposable(),
    },
  };
  const extension = loadExtension(entry);
  extension.activate(context);
  return { context, extension };
}

const cancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => new Disposable(),
};

test("activate 注册视图提供者与全部命令", () => {
  const { context } = setup();

  const registration = created.webviewProviders.get("tetris.game");
  assert.ok(registration, "tetris.game 的 provider 未注册");
  assert.ok(registration.provider.resolveWebviewView, "provider 缺少 resolveWebviewView");

  for (const command of pkg.contributes.commands) {
    assert.ok(created.commands.includes(command.command), `命令 ${command.command} 未注册`);
  }

  for (const disposable of context.subscriptions) disposable.dispose();
});

test("webview HTML 带 nonce 与严格 CSP", () => {
  const { context } = setup();
  const { provider } = created.webviewProviders.get("tetris.game");
  const view = createWebviewView("tetris.game");

  provider.resolveWebviewView(view, { state: undefined }, cancellationToken);

  assert.equal(view.webview.options.enableScripts, true);
  assert.ok(view.webview.options.localResourceRoots.length >= 1);
  assert.match(view.webview.html, /Content-Security-Policy/);
  assert.match(view.webview.html, /script-src 'nonce-[A-Za-z0-9]+'/);
  assert.match(view.webview.html, /default-src 'none'/);
  assert.match(view.webview.html, /webview\.js/);
  assert.match(view.webview.html, /webview\.css/);
  assert.doesNotMatch(view.webview.html, /unsafe-eval/);
  assert.doesNotMatch(view.webview.html, /unsafe-inline/);

  for (const disposable of context.subscriptions) disposable.dispose();
});

test("ready → init、gameOver → 最高分落盘、失焦 → 暂停", () => {
  const { context } = setup();
  const { provider } = created.webviewProviders.get("tetris.game");
  const view = createWebviewView("tetris.game");
  provider.resolveWebviewView(view, { state: undefined }, cancellationToken);

  view.webview.__receive({ type: "ready" });
  const init = view.webview.posted.find((message) => message.type === "init");
  assert.ok(init, "ready 之后没有收到 init");
  assert.equal(init.highScore, 0);
  assert.equal(init.settings.startLevel, 1);
  assert.equal(init.restore, null);

  view.webview.__receive({ type: "gameOver", score: 321 });
  assert.equal(context.globalState.get("tetris.highScore"), 321);
  const highScore = view.webview.posted.filter((message) => message.type === "highScore").at(-1);
  assert.equal(highScore.value, 321);

  stub.window.__windowStateListener({ focused: false });
  assert.equal(view.webview.posted.at(-1).type, "pause");

  for (const disposable of context.subscriptions) disposable.dispose();
});

test("toggle 在可见/隐藏两种状态下行为正确", async () => {
  const { context } = setup();
  const { provider } = created.webviewProviders.get("tetris.game");
  const view = createWebviewView("tetris.game");
  provider.resolveWebviewView(view, { state: undefined }, cancellationToken);
  view.webview.__receive({ type: "ready" });

  const toggle = stub.commands.registered.get("tetris.toggle");
  assert.ok(toggle, "tetris.toggle 未注册");

  // 可见且正在跑：暂停并把焦点还给编辑器。
  view.webview.__receive({ type: "status", status: "running", score: 0 });
  await toggle();
  assert.equal(view.webview.posted.at(-1).type, "pause");
  assert.ok(
    created.executedCommands.some(
      (call) => call.command === "workbench.action.focusActiveEditorGroup",
    ),
  );

  // 隐藏后按快捷键：展开容器并恢复。
  view.__hide();
  await toggle();
  assert.ok(
    created.executedCommands.some(
      (call) => call.command === "workbench.view.extension.tetrisPanel",
    ),
  );
  assert.equal(view.webview.posted.at(-1).type, "resume");

  for (const disposable of context.subscriptions) disposable.dispose();
});

test("resetHighScore 清空记录并通知 webview", async () => {
  const { context } = setup();
  const { provider } = created.webviewProviders.get("tetris.game");
  const view = createWebviewView("tetris.game");
  provider.resolveWebviewView(view, { state: undefined }, cancellationToken);
  view.webview.__receive({ type: "ready" });
  view.webview.__receive({ type: "gameOver", score: 99 });

  const reset = stub.commands.registered.get("tetris.resetHighScore");
  await reset();

  assert.equal(context.globalState.get("tetris.highScore", 0), 0);
  const last = view.webview.posted.at(-1);
  assert.equal(last.type, "highScore");
  assert.equal(last.value, 0);

  for (const disposable of context.subscriptions) disposable.dispose();
});

test(
  "vsix 内含运行所需文件且不含源码",
  { skip: process.env.SMOKE_TARGET !== "vsix" },
  () => {
    const vsix = join(root, `${pkg.name}-${pkg.version}.vsix`);
    assert.ok(existsSync(vsix), `找不到 ${vsix}，先运行 pnpm package`);

    const temp = mkdtempSync(join(tmpdir(), "vscode-tetris-vsix-"));
    try {
      execFileSync("unzip", ["-o", vsix, "-d", temp], { stdio: "ignore" });
      const extensionDir = join(temp, "extension");

      for (const file of [
        "package.json",
        "dist/extension.js",
        "dist/webview.js",
        "dist/webview.css",
        "media/activity-icon.svg",
        "images/icon.png",
        // vsce 会把这三个文件重命名成小写 / .txt。
        "readme.md",
        "changelog.md",
        "LICENSE.txt",
      ]) {
        assert.ok(existsSync(join(extensionDir, file)), `vsix 内缺少 ${file}`);
      }

      for (const forbidden of ["src", "scripts", "out-test", "tsconfig.json", "esbuild.mjs"]) {
        assert.equal(existsSync(join(extensionDir, forbidden)), false, `vsix 不应包含 ${forbidden}`);
      }

      const packaged = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
      assert.ok(existsSync(join(extensionDir, packaged.main)), "打包后的 main 入口不存在");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
