import * as vscode from "vscode";

import type { Settings } from "./game/types";
import type { LocalBoard } from "./leaderboard/localBoard";
import type { LeaderboardService } from "./leaderboard/service";
import { buildGameHtml } from "./webviewHtml";

export interface FloatingGameDeps {
  readonly extensionUri: vscode.Uri;
  readonly getSettings: () => Settings;
  readonly getHighScore: () => number;
  readonly setHighScore: (score: number) => boolean;
  readonly localBoard: LocalBoard;
  readonly leaderboard: LeaderboardService;
  /** 打开独立窗口前先暂停侧边栏里的那一局。 */
  readonly pausePanel: () => void;
  readonly log: vscode.LogOutputChannel;
}

interface WebviewMessage {
  readonly type?: unknown;
  readonly score?: unknown;
  readonly lines?: unknown;
  readonly level?: unknown;
  readonly requestId?: unknown;
}

/**
 * 独立窗口。
 *
 * VS Code 没有「任意尺寸原生窗口」的 API；能做到的最接近方案是创建一个
 * webview panel，再用 `workbench.action.moveEditorToNewWindow` 把它弹成
 * 浮动编辑器窗口。窗口大小由用户拖动决定，游戏内容本身保持小尺寸。
 */
export class FloatingGame implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly deps: FloatingGameDeps) {}

  isOpen(): boolean {
    return this.panel !== undefined;
  }

  reveal(): void {
    this.panel?.reveal();
  }

  async open(): Promise<void> {
    this.deps.pausePanel();

    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "tetris.floating",
      "Scratch",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.deps.extensionUri, "dist"),
          vscode.Uri.joinPath(this.deps.extensionUri, "media"),
        ],
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.deps.extensionUri, "images", "icon.png");

    this.disposables = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposeListeners();
      }),
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        this.onMessage(message);
      }),
    ];
    panel.webview.html = buildGameHtml(panel.webview, this.deps.extensionUri);

    try {
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    } catch (error) {
      this.deps.log.warn(`独立窗口不可用：${String(error)}`);
      void vscode.window.showInformationMessage(
        "当前 VS Code 不支持浮动编辑器窗口，已在新标签页打开。可以手动把标签拖出成独立窗口。",
      );
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.disposeListeners();
  }

  private onMessage(message: WebviewMessage): void {
    if (!message || typeof message !== "object") return;

    switch (message.type) {
      case "ready":
        // 独立窗口里直接开局，不显示草稿伪装页。
        this.post({
          type: "init",
          settings: { ...this.deps.getSettings(), autoStart: true, disguise: false },
          highScore: this.deps.getHighScore(),
          restore: null,
        });
        break;

      case "gameOver": {
        const score =
          typeof message.score === "number" && Number.isFinite(message.score)
            ? message.score
            : 0;
        const lines =
          typeof message.lines === "number" &&
          Number.isInteger(message.lines) &&
          message.lines >= 0
            ? message.lines
            : 0;
        const level =
          typeof message.level === "number" &&
          Number.isInteger(message.level) &&
          message.level >= 1 &&
          message.level <= 15
            ? message.level
            : 1;
        const requestId = typeof message.requestId === "string" ? message.requestId : "";

        this.deps.localBoard.record({
          score,
          lines,
          level,
          at: new Date().toISOString(),
        });

        if (this.deps.setHighScore(score)) {
          this.post({ type: "highScore", value: this.deps.getHighScore() });
        }

        const target = this.panel;
        void this.deps.leaderboard.submit(score, lines, level, (result) => {
          if (!result.ok || !target || this.panel !== target) return;
          void target.webview.postMessage({
            type: "rank",
            requestId,
            rank: result.value.rank,
            total: result.value.total,
          });
        });
        break;
      }

      case "panic":
        // 独立窗口里的 Esc：直接关掉这扇窗。
        this.panel?.dispose();
        break;

      default:
        break;
    }
  }

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private disposeListeners(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}
