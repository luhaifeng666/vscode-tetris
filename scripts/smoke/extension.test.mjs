import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
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
    secrets: stub.__createSecrets(),
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

      for (const forbidden of ["src", "scripts", "server", "out-test", "tsconfig.json", "esbuild.mjs"]) {
        assert.equal(existsSync(join(extensionDir, forbidden)), false, `vsix 不应包含 ${forbidden}`);
      }

      const packaged = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
      assert.ok(existsSync(join(extensionDir, packaged.main)), "打包后的 main 入口不存在");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

// ---- 排行榜 ----

function resetConfig() {
  for (const layer of [
    stub.__configScopes.global,
    stub.__configScopes.workspace,
    stub.__configScopes.workspaceFolder,
  ]) {
    for (const key of Object.keys(layer)) delete layer[key];
  }
}

async function startMockLeaderboard() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/v1/scores") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requests.push({ method: req.method, url: req.url, body });
        res.end(JSON.stringify({ rank: 3, total: 10, best: body.score }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/top") {
        requests.push({ method: req.method, url: req.url });
        res.end(JSON.stringify({ entries: [], total: 0, updatedAt: "x" }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function openGame(entry) {
  const { context } = setup(entry);
  const { provider } = created.webviewProviders.get("tetris.game");
  const view = createWebviewView("tetris.game");
  provider.resolveWebviewView(view, { state: undefined }, cancellationToken);
  view.webview.__receive({ type: "ready" });
  return { context, view };
}

test("开启并同意后，gameOver 上传并回传 rank", async () => {
  resetConfig();
  const mock = await startMockLeaderboard();
  const { context, view } = openGame();

  const config = stub.workspace.getConfiguration("tetris");
  await config.update("leaderboardEndpoint", mock.base, stub.ConfigurationTarget.Global);
  await config.update("leaderboardEnabled", true, stub.ConfigurationTarget.Global);
  await config.update("leaderboardNickname", "Tester", stub.ConfigurationTarget.Global);
  await context.globalState.update("tetris.leaderboardConsent", {
    endpoint: mock.base,
    fieldsVersion: 1,
    acceptedAt: new Date().toISOString(),
  });

  view.webview.__receive({
    type: "gameOver",
    score: 5000,
    lines: 20,
    level: 3,
    requestId: "run-1",
  });
  await new Promise((resolve) => setTimeout(resolve, 600));

  const posts = mock.requests.filter((request) => request.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.score, 5000);
  assert.equal(posts[0].body.lines, 20);
  assert.equal(posts[0].body.level, 3);
  assert.equal(posts[0].body.nickname, "Tester");
  assert.equal(typeof posts[0].body.playerId, "string");

  const rank = view.webview.posted.find((message) => message.type === "rank");
  assert.deepEqual(rank, {
    type: "rank",
    requestId: "run-1",
    rank: 3,
    total: 10,
  });

  for (const disposable of context.subscriptions) disposable.dispose();
  await mock.close();
});

test("默认关闭时 gameOver 不联网，但会记录本地榜", async () => {
  resetConfig();
  const mock = await startMockLeaderboard();
  const { context, view } = openGame();

  const config = stub.workspace.getConfiguration("tetris");
  await config.update("leaderboardEndpoint", mock.base, stub.ConfigurationTarget.Global);

  view.webview.__receive({
    type: "gameOver",
    score: 2500,
    lines: 12,
    level: 2,
    requestId: "run-2",
  });
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(mock.requests.length, 0);
  assert.equal(
    view.webview.posted.some((message) => message.type === "rank"),
    false,
  );

  const local = context.globalState.get("tetris.localTopScores");
  assert.equal(local.length, 1);
  assert.equal(local[0].score, 2500);

  for (const disposable of context.subscriptions) disposable.dispose();
  await mock.close();
});

test("workspace 级设置无法开启上传", async () => {
  resetConfig();
  const mock = await startMockLeaderboard();
  const { context, view } = openGame();

  const config = stub.workspace.getConfiguration("tetris");
  await config.update("leaderboardEndpoint", mock.base, stub.ConfigurationTarget.Workspace);
  await config.update("leaderboardEnabled", true, stub.ConfigurationTarget.Workspace);
  await context.globalState.update("tetris.leaderboardConsent", {
    endpoint: mock.base,
    fieldsVersion: 1,
    acceptedAt: new Date().toISOString(),
  });

  view.webview.__receive({
    type: "gameOver",
    score: 9999,
    lines: 30,
    level: 5,
    requestId: "run-3",
  });
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(mock.requests.length, 0);

  for (const disposable of context.subscriptions) disposable.dispose();
  await mock.close();
});
