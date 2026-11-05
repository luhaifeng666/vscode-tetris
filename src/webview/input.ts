import type { Input } from "../game/types";

export type Action = Input | "panic" | "togglePause";

/**
 * 把键盘事件翻译成游戏动作。返回 null 表示这个键不归我们管。
 *
 * 带 Ctrl/Cmd/Alt 的组合一律放行给 VS Code —— 否则会吃掉用户的
 * 保存、命令面板等全局快捷键。
 */
export function keyToAction(event: KeyboardEvent, repeat: boolean): Action | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const action = mapCode(event.code);
  if (action === null) return null;

  // 长按时只让移动与软降连续触发；旋转、硬降、暂停等必须重新按键。
  if (repeat && action !== "left" && action !== "right" && action !== "softDropOn") {
    return null;
  }
  return action;
}

function mapCode(code: string): Action | null {
  switch (code) {
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    case "ArrowUp":
    case "KeyW":
    case "KeyX":
      return "rotateCW";
    case "KeyZ":
      return "rotateCCW";
    case "ArrowDown":
    case "KeyS":
      return "softDropOn";
    case "Space":
      return "hardDrop";
    case "KeyP":
      return "togglePause";
    case "KeyR":
      return "restart";
    case "Enter":
      return "start";
    case "Escape":
      return "panic";
    default:
      return null;
  }
}

export function isSoftDropKey(code: string): boolean {
  return code === "ArrowDown" || code === "KeyS";
}
