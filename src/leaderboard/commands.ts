import * as vscode from "vscode";

import { readLeaderboardSettings } from "../config";
import { readConsent, writeConsent } from "./consent";
import { getOrCreatePlayerId } from "./identity";
import type { LocalBoard } from "./localBoard";
import { cleanNickname } from "./policy";
import { FIELDS_VERSION, type LeaderboardService } from "./service";

export const COMMAND_SHOW_LEADERBOARD = "tetris.showLeaderboard";
export const COMMAND_ENABLE_LEADERBOARD = "tetris.enableLeaderboard";
export const COMMAND_SET_NICKNAME = "tetris.setNickname";

export interface LeaderboardCommandDeps {
  readonly context: vscode.ExtensionContext;
  readonly service: LeaderboardService;
  readonly localBoard: LocalBoard;
  readonly log: vscode.LogOutputChannel;
}

type ItemAction = "enable" | "nickname" | "refresh" | "settings";
interface LeaderboardItem extends vscode.QuickPickItem {
  readonly action?: ItemAction;
}

function warn(deps: LeaderboardCommandDeps): (message: string) => void {
  return (message) => deps.log.warn(message);
}

function hasConsent(deps: LeaderboardCommandDeps, endpoint: string): boolean {
  const consent = readConsent(deps.context);
  return (
    consent !== undefined &&
    consent.endpoint === endpoint &&
    consent.fieldsVersion === FIELDS_VERSION
  );
}

function shortDate(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

async function showLeaderboard(deps: LeaderboardCommandDeps): Promise<void> {
  const settings = readLeaderboardSettings(undefined, warn(deps));
  const items: LeaderboardItem[] = [];
  let online = false;
  let note = "";

  if (settings.enabled && settings.endpoint && hasConsent(deps, settings.endpoint)) {
    const result = await deps.service.fetchTop();
    if (result.ok) {
      online = true;
      if (result.value.entries.length === 0) {
        items.push({
          label: "还没有人在线提交成绩",
          description: "完成一局后就会出现在这里",
        });
      } else {
        for (const entry of result.value.entries) {
          items.push({
            label: `#${entry.rank}  ${entry.nickname}`,
            description: `${entry.score} 分`,
            detail: `等级 ${entry.level} · ${entry.lines} 行 · ${shortDate(entry.at)}`,
          });
        }
      }
    } else {
      note = "在线榜暂时不可用，显示本地成绩";
      deps.log.warn(`读取在线排行榜失败：${result.error.kind}`);
    }
  } else if (!settings.enabled) {
    items.push({
      label: "$(plug) 开启在线排行榜",
      description: "上传分数，和所有人比 TOP10",
      action: "enable",
    });
  } else if (!settings.endpoint) {
    items.push({
      label: "$(gear) 配置在线排行榜地址",
      description: "设置 tetris.leaderboardEndpoint",
      action: "settings",
    });
  } else {
    items.push({
      label: "$(warning) 完成在线排行榜设置",
      description: "需要同意上传字段",
      action: "enable",
    });
  }

  if (!online) {
    const local = deps.localBoard.get();
    if (local.length > 0) {
      items.push({ label: "本地 TOP10", kind: vscode.QuickPickItemKind.Separator });
      local.forEach((entry, index) => {
        items.push({
          label: `#${index + 1}  本地`,
          description: `${entry.score} 分`,
          detail: `等级 ${entry.level} · ${entry.lines} 行 · ${shortDate(entry.at)}`,
        });
      });
    } else {
      items.push({ label: "还没有本地成绩", description: "完成一局后记录在这里" });
    }
  }

  items.push(
    { label: "$(pencil) 设置昵称", action: "nickname" },
    { label: "$(refresh) 刷新", action: "refresh" },
  );

  const picked = await vscode.window.showQuickPick<LeaderboardItem>(items, {
    title: "俄罗斯方块排行榜",
    placeHolder: note || (online ? "在线 TOP10" : "本地成绩"),
  });

  if (!picked?.action) return;
  switch (picked.action) {
    case "enable":
      await enableLeaderboard(deps);
      break;
    case "nickname":
      await promptNickname(deps);
      break;
    case "settings":
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "tetris.leaderboardEndpoint",
      );
      break;
    case "refresh":
      await showLeaderboard(deps);
      break;
  }
}

async function enableLeaderboard(deps: LeaderboardCommandDeps): Promise<void> {
  const settings = readLeaderboardSettings(undefined, warn(deps));

  if (!settings.endpoint) {
    await vscode.window.showInformationMessage(
      "请先配置 tetris.leaderboardEndpoint（https 地址），再开启在线排行榜。",
    );
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "tetris.leaderboardEndpoint",
    );
    return;
  }

  if (deps.service.canUpload()) {
    await vscode.window.showInformationMessage("在线排行榜已开启。");
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `开启在线排行榜后，以下信息会发送到：\n${settings.endpoint}\n\n· 随机玩家 ID\n· 昵称\n· 分数、消行数、等级\n· 扩展版本\n\n不会上传棋盘、输入、代码、文件或账号信息。`,
    { modal: true },
    "同意并开启",
  );
  if (choice !== "同意并开启") return;

  const playerId = await getOrCreatePlayerId(deps.context);
  if (!playerId) {
    await vscode.window.showErrorMessage("无法生成玩家 ID，在线排行榜未开启。");
    return;
  }

  writeConsent(deps.context, settings.endpoint);
  await vscode.workspace
    .getConfiguration("tetris")
    .update("leaderboardEnabled", true, vscode.ConfigurationTarget.Global);
  deps.log.info("在线排行榜已开启");

  if (!settings.nickname) await promptNickname(deps);
  await vscode.window.showInformationMessage("在线排行榜已开启。");
}

async function promptNickname(deps: LeaderboardCommandDeps): Promise<void> {
  const settings = readLeaderboardSettings(undefined, warn(deps));
  const value = await vscode.window.showInputBox({
    title: "排行榜昵称",
    prompt: "最多 24 个字符；留空则使用匿名名字。",
    value: settings.nickname,
    validateInput: (input) =>
      [...cleanNickname(input)].length > 24 ? "最多 24 个字符" : undefined,
  });
  if (value === undefined) return;

  const cleaned = [...cleanNickname(value)].slice(0, 24).join("");
  await vscode.workspace
    .getConfiguration("tetris")
    .update("leaderboardNickname", cleaned, vscode.ConfigurationTarget.Global);
  await vscode.window.showInformationMessage(
    cleaned ? `排行榜昵称已设置为 ${cleaned}` : "已清空昵称，将使用匿名名字。",
  );
}

export function registerLeaderboardCommands(
  deps: LeaderboardCommandDeps,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_SHOW_LEADERBOARD, () =>
      showLeaderboard(deps),
    ),
    vscode.commands.registerCommand(COMMAND_ENABLE_LEADERBOARD, () =>
      enableLeaderboard(deps),
    ),
    vscode.commands.registerCommand(COMMAND_SET_NICKNAME, () =>
      promptNickname(deps),
    ),
  ];
}
