import * as vscode from "vscode";

import { registerCommands } from "./commands";
import { onSettingsChanged, readSettings } from "./config";
import { FloatingGame } from "./floatingGame";
import { GamePanel } from "./gamePanel";
import { initLogger } from "./logging";
import { ScoreStore } from "./scoreStore";

export function activate(context: vscode.ExtensionContext): void {
  const log = initLogger();
  context.subscriptions.push(log);

  let settings = readSettings(undefined, (message) => log.warn(message));

  const scores = new ScoreStore(context.globalState, log);
  context.subscriptions.push(scores);

  const panel = new GamePanel({
    extensionUri: context.extensionUri,
    getSettings: () => settings,
    getHighScore: () => scores.get(),
    setHighScore: (score) => scores.update(score),
    log,
  });

  const floating = new FloatingGame({
    extensionUri: context.extensionUri,
    getSettings: () => settings,
    getHighScore: () => scores.get(),
    setHighScore: (score) => scores.update(score),
    pausePanel: () => panel.pause(),
    log,
  });
  context.subscriptions.push(floating);

  /**
   * 失焦/切编辑器/收起视图都走这里。
   *
   * GamePanel.pause() 对非 running 状态是幂等的：webview 收到 pause 后
   * applyInput 会直接返回原状态，所以不需要宿主再维护一份精确状态。
   */
  const autoPause = (): void => {
    if (!settings.autoPause) return;
    panel.pause();
    panel.hideIfStealth();
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GamePanel.viewId, panel),

    ...registerCommands(context, panel, scores, floating),

    onSettingsChanged(() => {
      settings = readSettings(undefined, (message) => log.warn(message));
      panel.pushSettings(settings);
    }),

    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) autoPause();
    }),

    vscode.window.onDidChangeActiveTextEditor(() => {
      autoPause();
    }),

    { dispose: () => panel.dispose() },
  );

  log.info("俄罗斯方块已激活");
}

export function deactivate(): void {
  // 所有资源都在 context.subscriptions 里，VS Code 会统一释放。
}
