import * as vscode from "vscode";

import type { Settings, Skin } from "./game/types";
import { normalizeEndpoint } from "./leaderboard/policy";

export const CONFIG_SECTION = "tetris";

export type WarningReporter = (message: string) => void;

export interface LeaderboardSettings {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly nickname: string;
}

/**
 * 只读 machine 级（global/default），显式忽略 workspace/workspaceFolder。
 * 否则仓库里的 .vscode/settings.json 就能把分数发到任意地址。
 */
function machineValue<T>(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: T,
): T {
  const inspected = config.inspect<T>(key);
  const value = inspected?.globalValue ?? inspected?.defaultValue;
  return value === undefined ? fallback : value;
}

export function readLeaderboardSettings(
  section?: vscode.WorkspaceConfiguration,
  warn: WarningReporter = () => {},
): LeaderboardSettings {
  const config = section ?? vscode.workspace.getConfiguration(CONFIG_SECTION);

  const enabled = machineValue<boolean>(config, "leaderboardEnabled", false) === true;

  const rawEndpoint = machineValue<string>(config, "leaderboardEndpoint", "");
  let endpoint = "";
  if (typeof rawEndpoint === "string" && rawEndpoint.trim().length > 0) {
    const normalized = normalizeEndpoint(rawEndpoint);
    if (normalized.ok) {
      endpoint = normalized.value;
    } else {
      warn(
        `tetris.leaderboardEndpoint 不合法（${normalized.error.message ?? "invalid"}），在线排行榜已停用。`,
      );
    }
  }

  const rawNickname = machineValue<string>(config, "leaderboardNickname", "");
  const nickname = typeof rawNickname === "string" ? rawNickname : "";

  return { enabled, endpoint, nickname };
}

/**
 * 读取设置。值来自用户可编辑的 JSON，逐项做防御性校验，
 * 非法值回退默认而不是让扩展崩掉。
 */
export function readSettings(
  section?: vscode.WorkspaceConfiguration,
  warn: WarningReporter = () => {},
): Settings {
  const config = section ?? vscode.workspace.getConfiguration(CONFIG_SECTION);

  const rawAutoPause = config.get<boolean>("autoPause");
  const autoPause = typeof rawAutoPause === "boolean" ? rawAutoPause : true;

  const rawDisguise = config.get<boolean>("disguise");
  const disguise = typeof rawDisguise === "boolean" ? rawDisguise : true;

  const rawAutoStart = config.get<boolean>("autoStart");
  const autoStart = typeof rawAutoStart === "boolean" ? rawAutoStart : false;

  const rawMusic = config.get<boolean>("music");
  const music = typeof rawMusic === "boolean" ? rawMusic : true;

  const rawSoundEffects = config.get<boolean>("soundEffects");
  const soundEffects = typeof rawSoundEffects === "boolean" ? rawSoundEffects : true;

  const rawHidePanel = config.get<boolean>("hideSidebarOnPause");
  const hideSidebarOnPause = typeof rawHidePanel === "boolean" ? rawHidePanel : true;

  const rawSkin = config.get<string>("skin");
  const skin: Skin =
    rawSkin === "light" || rawSkin === "transparent" ? rawSkin : "gameboy";

  const rawLevel = config.get<number>("startLevel");
  let startLevel = 1;
  if (typeof rawLevel === "number" && Number.isFinite(rawLevel)) {
    startLevel = Math.min(10, Math.max(1, Math.floor(rawLevel)));
  } else if (rawLevel !== undefined) {
    warn(`tetris.startLevel 不是数字（${String(rawLevel)}），已回退到 1。`);
  }

  return { autoPause, disguise, autoStart, startLevel, music, soundEffects, hideSidebarOnPause, skin };
}

/** 只在 tetris 这一段变化时回调。 */
export function onSettingsChanged(reporter: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) reporter();
  });
}
