import * as vscode from "vscode";

import type { GameStatus, Settings } from "./game/types";
import { buildGameHtml } from "./webviewHtml";

export interface GamePanelDeps {
  readonly extensionUri: vscode.Uri;
  readonly getSettings: () => Settings;
  readonly getHighScore: () => number;
  /** 返回是否刷新了记录。 */
  readonly setHighScore: (score: number) => boolean;
  readonly log: vscode.LogOutputChannel;
}

interface WebviewMessage {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly score?: unknown;
}

const VIEW_ID = "tetris.game";
const CONTAINER_ID = "tetrisPanel";

/**
 * 侧边栏里的那一局。
 *
 * 游戏状态全部在 webview 里，宿主只负责三件事：把设置/最高分送进去、
 * 在失焦时喊暂停、在视图销毁后从 setState 快照恢复。这样引擎可以保持纯函数，
 * 宿主也不需要每帧转发消息。
 */
export class GamePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = VIEW_ID;

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private restoreState: unknown;
  private ready = false;
  private pendingStart = false;
  private status: GameStatus = "idle";

  constructor(private readonly deps: GamePanelDeps) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
  ): void {
    this.disposeViewListeners();
    this.view = view;
    this.restoreState = context.state;
    this.ready = false;
    this.status = "idle";

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.deps.extensionUri, "dist"),
        vscode.Uri.joinPath(this.deps.extensionUri, "media"),
      ],
    };
    view.webview.html = buildGameHtml(view.webview, this.deps.extensionUri);

    this.viewDisposables = [
      view.onDidDispose(() => {
        this.view = undefined;
        this.ready = false;
        this.disposeViewListeners();
      }),
      // 注意事件本身没有参数：必须读 view.visible。
      view.onDidChangeVisibility(() => {
        if (!view.visible) this.pause();
      }),
      view.webview.onDidReceiveMessage((message: WebviewMessage) => {
        this.onMessage(message);
      }),
    ];
  }

  async reveal(): Promise<void> {
    if (this.view?.visible) {
      this.view.show(false);
      return;
    }

    try {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
    } catch (error) {
      this.deps.log.warn(`打开面板失败：${String(error)}`);
    }

    if (this.view) {
      this.view.show(false);
    } else {
      // 容器已展开但视图尚未解析时，contributed view 会生成 <viewId>.focus。
      try {
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      } catch (error) {
        this.deps.log.warn(`聚焦游戏视图失败：${String(error)}`);
      }
    }
  }

  async toggle(): Promise<void> {
    const visible = this.view?.visible ?? false;

    if (!visible) {
      this.pendingStart = true;
      await this.reveal();
      this.flushPendingStart();
      return;
    }

    if (this.status === "running") {
      this.pause();
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      this.hideIfStealth();
      return;
    }

    this.post({ type: "resume" });
  }

  pause(): void {
    this.post({ type: "pause" });
  }

  restart(): void {
    this.post({ type: "restart" });
  }

  panic(): void {
    this.post({ type: "panic" });
  }

  /**
   * 老板键：暂停后直接隐藏整个侧边栏。
   * 这样连游戏视图都看不到，只剩 Activity Bar 上一个中性的 Scratch 图标。
   */
  hideIfStealth(): void {
    if (!this.deps.getSettings().hideSidebarOnPause) return;
    void vscode.commands
      .executeCommand("workbench.action.closeSidebar")
      .then(undefined, (error: unknown) => {
        this.deps.log.warn(`隐藏侧边栏失败：${String(error)}`);
      });
  }

  pushSettings(settings: Settings): void {
    this.post({ type: "settings", settings });
  }

  resetHighScore(): void {
    this.post({ type: "highScore", value: 0 });
  }

  dispose(): void {
    this.disposeViewListeners();
    this.view = undefined;
  }

  private flushPendingStart(): void {
    if (!this.pendingStart || !this.ready) return;
    this.pendingStart = false;
    this.post({ type: "resume" });
  }

  private onMessage(message: WebviewMessage): void {
    if (!message || typeof message !== "object") return;

    switch (message.type) {
      case "ready":
        this.ready = true;
        this.post({
          type: "init",
          settings: this.deps.getSettings(),
          highScore: this.deps.getHighScore(),
          restore: this.restoreState ?? null,
        });
        // 快照只消费一次；后续重建由 VS Code 通过 context.state 再给。
        this.restoreState = undefined;
        this.flushPendingStart();
        break;

      case "status":
        if (
          message.status === "idle" ||
          message.status === "running" ||
          message.status === "paused" ||
          message.status === "gameOver"
        ) {
          this.status = message.status;
        }
        break;

      case "gameOver": {
        const score =
          typeof message.score === "number" && Number.isFinite(message.score)
            ? message.score
            : 0;
        if (this.deps.setHighScore(score)) {
          this.post({ type: "highScore", value: this.deps.getHighScore() });
        }
        break;
      }

      case "panic":
        void vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
        this.hideIfStealth();
        break;

      default:
        break;
    }
  }

  private post(message: unknown): void {
    if (!this.view) return;
    void this.view.webview.postMessage(message);
  }

  private disposeViewListeners(): void {
    for (const disposable of this.viewDisposables) disposable.dispose();
    this.viewDisposables = [];
    this.ready = false;
  }
}
