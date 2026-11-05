import * as vscode from "vscode";

import type { Settings, Skin } from "./game/types";

export const CONFIG_SECTION = "tetris";

export type WarningReporter = (message: string) => void;

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
