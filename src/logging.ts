import * as vscode from "vscode";

/**
 * 日志通道。
 *
 * 这个扩展不碰任何凭据，所以签名上没有需要防泄漏的参数；
 * 保持和现有扩展一致的 LogOutputChannel 用法即可。
 */
export function initLogger(): vscode.LogOutputChannel {
  return vscode.window.createOutputChannel("俄罗斯方块", { log: true });
}
