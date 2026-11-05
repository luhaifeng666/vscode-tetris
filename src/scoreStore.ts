import * as vscode from "vscode";

const HIGH_SCORE_KEY = "tetris.highScore";

/** 最高分只存在 globalState 里：换工作区不该把记录清零。 */
export class ScoreStore implements vscode.Disposable {
  constructor(
    private readonly memento: vscode.Memento,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  get(): number {
    const value = this.memento.get<number>(HIGH_SCORE_KEY, 0);
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  }

  /** 返回是否刷新了记录。 */
  update(score: number): boolean {
    if (!Number.isFinite(score) || score <= this.get()) return false;
    void this.memento.update(HIGH_SCORE_KEY, Math.floor(score));
    this.log.info(`新的最高分：${Math.floor(score)}`);
    return true;
  }

  reset(): void {
    void this.memento.update(HIGH_SCORE_KEY, undefined);
    this.log.info("最高分已清除");
  }

  dispose(): void {
    // globalState 由 VS Code 管理，这里没有需要释放的资源。
  }
}
