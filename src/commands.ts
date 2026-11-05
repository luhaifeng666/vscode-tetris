import * as vscode from "vscode";

import type { FloatingGame } from "./floatingGame";
import type { GamePanel } from "./gamePanel";
import type { ScoreStore } from "./scoreStore";

export const COMMAND_TOGGLE = "tetris.toggle";
export const COMMAND_OPEN_WINDOW = "tetris.openWindow";
export const COMMAND_RESTART = "tetris.restart";
export const COMMAND_RESET_HIGH_SCORE = "tetris.resetHighScore";
export const COMMAND_OPEN_SETTINGS = "tetris.openSettings";

export function registerCommands(
  context: vscode.ExtensionContext,
  panel: GamePanel,
  scores: ScoreStore,
  floating: FloatingGame,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_TOGGLE, () => {
      // 独立窗口开着就先把焦点给它，避免同时开两局。
      if (floating.isOpen()) {
        floating.reveal();
        return;
      }
      return panel.toggle();
    }),

    vscode.commands.registerCommand(COMMAND_OPEN_WINDOW, () => floating.open()),

    vscode.commands.registerCommand(COMMAND_RESTART, () => panel.restart()),

    vscode.commands.registerCommand(COMMAND_RESET_HIGH_SCORE, async () => {
      const choice = await vscode.window.showWarningMessage(
        "清除俄罗斯方块的最高分记录？",
        { modal: true },
        "清除",
      );
      if (choice !== "清除") return;
      scores.reset();
      panel.resetHighScore();
      vscode.window.showInformationMessage("最高分已清除。");
    }),

    vscode.commands.registerCommand(COMMAND_OPEN_SETTINGS, () => {
      const { publisher, name } = context.extension.packageJSON as {
        publisher?: string;
        name?: string;
      };
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `@ext:${publisher}.${name}`,
      );
    }),
  ];
}
