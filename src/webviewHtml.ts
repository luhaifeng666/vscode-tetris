import * as vscode from "vscode";

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}

/** 底部面板视图和独立窗口共用同一份 webview 文档。 */
export function buildGameHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.css"),
  );

  // 没有内联脚本/样式，nonce 只给唯一的入口脚本。
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Scratch</title>
</head>
<body>
  <div id="app">
    <section id="scratch" class="scratch">
      <h1 class="scratch-title">notes</h1>
      <p>- 整理一下待办</p>
      <p>- 检查构建日志</p>
      <p>- 下午再看</p>
      <p><span class="caret"></span></p>
      <div id="scratch-status" class="scratch-status"></div>
      <div class="scratch-hint">Ctrl/⌘ + Alt + T</div>
    </section>

    <section id="game" class="game hidden">
      <div class="console">
        <div id="board-wrap" class="board-wrap">
          <canvas id="board"></canvas>
          <div id="overlay" class="overlay hidden"></div>
        </div>
        <aside class="side">
          <div class="stat-box">
            <div class="stat-label">SCORE</div>
            <div class="stat-value" id="score">0</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">LEVEL</div>
            <div class="stat-value" id="level">1</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">LINES</div>
            <div class="stat-value" id="lines">0</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">BEST</div>
            <div class="stat-value" id="best">0</div>
          </div>
          <div class="stat-box next-box">
            <div class="stat-label">NEXT</div>
            <canvas id="next"></canvas>
          </div>
        </aside>
      </div>
    </section>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
