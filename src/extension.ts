import * as vscode from "vscode";

import { registerCommands } from "./commands";
import { onSettingsChanged, readLeaderboardSettings, readSettings } from "./config";
import { FloatingGame } from "./floatingGame";
import { GamePanel } from "./gamePanel";
import { LeaderboardClient } from "./leaderboard/client";
import { registerLeaderboardCommands } from "./leaderboard/commands";
import { readConsent } from "./leaderboard/consent";
import { getOrCreatePlayerId } from "./leaderboard/identity";
import { LocalBoard } from "./leaderboard/localBoard";
import { LeaderboardService } from "./leaderboard/service";
import { initLogger } from "./logging";
import { ScoreStore } from "./scoreStore";

export function activate(context: vscode.ExtensionContext): void {
  const log = initLogger();
  context.subscriptions.push(log);

  let settings = readSettings(undefined, (message) => log.warn(message));

  const scores = new ScoreStore(context.globalState, log);
  context.subscriptions.push(scores);

  const localBoard = new LocalBoard(context.globalState);
  const leaderboard = new LeaderboardService({
    getSettings: () => readLeaderboardSettings(undefined, (message) => log.warn(message)),
    getConsent: () => readConsent(context),
    getPlayerId: () => getOrCreatePlayerId(context),
    getVersion: () =>
      String((context.extension.packageJSON as { version?: unknown }).version ?? "unknown"),
    createClient: (endpoint) => new LeaderboardClient(endpoint),
    log,
  });

  const panel = new GamePanel({
    extensionUri: context.extensionUri,
    getSettings: () => settings,
    getHighScore: () => scores.get(),
    setHighScore: (score) => scores.update(score),
    localBoard,
    leaderboard,
    log,
  });

  const floating = new FloatingGame({
    extensionUri: context.extensionUri,
    getSettings: () => settings,
    getHighScore: () => scores.get(),
    setHighScore: (score) => scores.update(score),
    localBoard,
    leaderboard,
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

    ...registerCommands(context, panel, scores, floating, localBoard),

    ...registerLeaderboardCommands({
      context,
      service: leaderboard,
      localBoard,
      log,
    }),

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
