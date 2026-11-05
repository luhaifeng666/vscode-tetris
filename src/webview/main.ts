import { applyInput, createGame, tick } from "../game/engine";
import type { ActivePiece, GameEvent, GameState, GameStatus, Input, PieceKind, Settings, StepResult } from "../game/types";
import { COLS, PIECE_KINDS, ROWS } from "../game/types";
import { AudioEngine } from "./audio";
import { isSoftDropKey, keyToAction } from "./input";
import { drawBoard, drawClearAnimation, drawNext } from "./renderer";
import { applySkinToDom, paletteFor, watchTheme, type Palette } from "./skin";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type HostMessage =
  | { type: "init"; settings: Settings; highScore: number; restore: unknown }
  | { type: "settings"; settings: Settings }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "restart" }
  | { type: "panic" }
  | { type: "highScore"; value: number };

const vscode = acquireVsCodeApi();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少元素 #${id}`);
  return found as T;
}

const gameSection = element<HTMLElement>("game");
const scratchSection = element<HTMLElement>("scratch");
const scratchStatus = element<HTMLElement>("scratch-status");
const overlay = element<HTMLElement>("overlay");
const boardCanvas = element<HTMLCanvasElement>("board");
const nextCanvas = element<HTMLCanvasElement>("next");
const boardWrap = element<HTMLElement>("board-wrap");
const scoreLabel = element<HTMLElement>("score");
const levelLabel = element<HTMLElement>("level");
const linesLabel = element<HTMLElement>("lines");
const bestLabel = element<HTMLElement>("best");

const CLEAR_ANIMATION_MS = 260;

interface ClearAnimation {
  readonly board: Uint8Array;
  readonly rows: readonly number[];
  readonly startedAt: number;
}

let settings: Settings = {
  autoPause: true,
  disguise: true,
  autoStart: false,
  startLevel: 1,
  music: true,
  soundEffects: true,
  hideSidebarOnPause: true,
  skin: "gameboy",
};
let highScore = 0;
let clearAnimation: ClearAnimation | null = null;

applySkinToDom(settings.skin);
let palette: Palette = paletteFor(settings.skin);

const audio = new AudioEngine();
let state: GameState = createGame({
  seed: Date.now() >>> 0,
  startLevel: settings.startLevel,
  highScore: 0,
});

let lastPersist = 0;

function persist(force = false): void {
  const now = performance.now();
  if (!force && now - lastPersist < 500) return;
  lastPersist = now;

  vscode.setState({
    board: Array.from(state.board),
    active: state.active,
    next: state.next,
    score: state.score,
    lines: state.lines,
    level: state.level,
    startLevel: state.startLevel,
    // 正在进行的对局按暂停存：恢复时不希望方块自己往下掉。
    status: state.status === "running" ? "paused" : state.status,
    rngState: state.rngState,
    highScore: Math.max(highScore, state.highScore),
  });
}

function updateHud(): void {
  scoreLabel.textContent = String(state.score);
  levelLabel.textContent = String(state.level);
  linesLabel.textContent = String(state.lines);
  bestLabel.textContent = String(Math.max(highScore, state.highScore));
}

function handleEvents(events: readonly GameEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case "statusChanged":
        audio.sync(event.status === "running");
        vscode.postMessage({ type: "status", status: event.status, score: state.score });
        break;
      case "gameOver":
        audio.gameOver();
        vscode.postMessage({ type: "gameOver", score: event.score });
        break;
      case "lock":
        audio.lock();
        break;
      case "lineClear":
        audio.clear(event.count);
        break;
      case "levelUp":
        audio.levelUp();
        break;
    }
  }
}

function renderOverlay(): void {
  let text = "";
  if (state.status === "idle") {
    text = "准备好了吗？\n按 Enter 或 Ctrl/⌘+Alt+T 开始";
  } else if (state.status === "paused") {
    text = "已暂停";
  } else if (state.status === "gameOver") {
    text = `游戏结束 · ${state.score} 分\n最高分 ${Math.max(highScore, state.highScore)}\n按 R 重开`;
  }
  overlay.textContent = text;
  overlay.classList.toggle("hidden", text === "");
}

function render(): void {
  const showGame =
    !settings.disguise || state.status === "running" || state.status === "gameOver";

  gameSection.classList.toggle("hidden", !showGame);
  scratchSection.classList.toggle("hidden", showGame);

  if (showGame) {
    if (clearAnimation) {
      const progress = (performance.now() - clearAnimation.startedAt) / CLEAR_ANIMATION_MS;
      if (progress < 1) {
        drawClearAnimation(boardCanvas, clearAnimation.board, clearAnimation.rows, progress, palette);
      } else {
        clearAnimation = null;
        drawBoard(boardCanvas, state, palette);
      }
    } else {
      drawBoard(boardCanvas, state, palette);
    }
    drawNext(nextCanvas, state.next, palette);
    renderOverlay();
  } else {
    scratchStatus.textContent = state.status === "paused" ? "paused" : "";
  }
}

function commit(result: StepResult): void {
  // 动画必须用「写入方块但尚未消行」的棋盘快照，否则刚落下的那块会凭空消失。
  for (const event of result.events) {
    if (event.type === "lineClear") {
      clearAnimation = {
        board: event.board,
        rows: event.rows,
        startedAt: performance.now(),
      };
    }
  }

  state = result.state;
  handleEvents(result.events);
  updateHud();
  render();
  persist();
}

const PIECE_SET = new Set<string>(PIECE_KINDS);

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

/**
 * 恢复 setState 存下的快照。任何一项形状不对就整体作废，
 * 宁可重开一局也不要把半个棋盘渲染出来。
 */
function restore(raw: unknown): GameState | null {
  if (raw === null || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  const board = data.board;
  if (!Array.isArray(board) || board.length !== COLS * ROWS) return null;
  if (!board.every((value) => Number.isInteger(value) && value >= 0 && value <= 7)) {
    return null;
  }

  let active: ActivePiece | null = null;
  if (data.active !== null && data.active !== undefined) {
    if (typeof data.active !== "object") return null;
    const piece = data.active as Record<string, unknown>;
    const { kind, rotation, x, y } = piece;
    if (typeof kind !== "string" || !PIECE_SET.has(kind)) return null;
    if (rotation !== 0 && rotation !== 1 && rotation !== 2 && rotation !== 3) return null;
    const pieceX = finiteNumber(x);
    const pieceY = typeof y === "number" && Number.isFinite(y) ? Math.trunc(y) : null;
    if (pieceX === null || pieceY === null) return null;
    active = { kind: kind as PieceKind, rotation, x: pieceX, y: pieceY };
  }

  const next = data.next;
  if (typeof next !== "string" || !PIECE_SET.has(next)) return null;

  const score = finiteNumber(data.score);
  const lines = finiteNumber(data.lines);
  const level = finiteNumber(data.level);
  const startLevel = finiteNumber(data.startLevel);
  const rngState = finiteNumber(data.rngState);
  if (score === null || lines === null || level === null || startLevel === null || rngState === null) {
    return null;
  }

  const rawStatus = data.status;
  const status: GameStatus =
    rawStatus === "idle" || rawStatus === "gameOver" ? rawStatus : "paused";

  return {
    board: Uint8Array.from(board as number[]),
    active,
    next: next as PieceKind,
    score,
    lines,
    level: Math.min(15, Math.max(1, level)),
    startLevel: Math.min(10, Math.max(1, startLevel)),
    status,
    dropAccumulator: 0,
    softDropping: false,
    rngState: rngState === 0 ? 1 : rngState,
    highScore: finiteNumber(data.highScore) ?? 0,
  };
}

function panic(): void {
  if (state.status === "running") {
    commit(applyInput(state, "pause"));
  }
  persist(true);
  vscode.postMessage({ type: "panic" });
}

function togglePause(): void {
  if (state.status === "running") {
    commit(applyInput(state, "pause"));
  } else {
    // start 自带 idle → running、paused → running、gameOver → 新开一局。
    commit(applyInput(state, "start"));
  }
}

function play(input: Input): void {
  // 消行动画期间冻结操作，避免新方块在旧棋盘上移动。
  if (
    clearAnimation &&
    input !== "pause" &&
    input !== "resume" &&
    input !== "start" &&
    input !== "restart"
  ) {
    return;
  }

  if (input === "start" || input === "restart") {
    clearAnimation = null;
  }

  const before = state.active;
  const wasRunning = state.status === "running";
  const result = applyInput(state, input);

  if (wasRunning) {
    if (
      (input === "rotateCW" || input === "rotateCCW") &&
      before &&
      result.state.active &&
      result.state.active.kind === before.kind &&
      result.state.active.rotation !== before.rotation
    ) {
      audio.rotate();
    } else if (input === "hardDrop") {
      audio.hardDrop();
    }
  }

  commit(result);
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      settings = { ...message.settings, skin: message.settings.skin ?? "gameboy" };
      audio.setSettings(settings);
      applySkinToDom(settings.skin);
      palette = paletteFor(settings.skin);
      clearAnimation = null;
      highScore = Math.max(0, Math.trunc(message.highScore));
      const restored = restore(message.restore);
      if (restored) {
        // 宿主才是最高分的权威来源：用户可能在面板关闭时清过记录。
        state = { ...restored, highScore };
      } else {
        state = createGame({
          seed: Date.now() >>> 0,
          startLevel: settings.startLevel,
          highScore,
        });
        if (settings.autoStart) state = applyInput(state, "start").state;
      }
      updateHud();
      render();
      audio.sync(state.status === "running");
      persist(true);
      vscode.postMessage({ type: "status", status: state.status, score: state.score });
      break;
    }
    case "settings":
      settings = { ...message.settings, skin: message.settings.skin ?? "gameboy" };
      audio.setSettings(settings);
      applySkinToDom(settings.skin);
      palette = paletteFor(settings.skin);
      // 未开局/已结束时改起始等级，下一局立即生效；正在进行的对局不受影响。
      if (state.status === "idle" || state.status === "gameOver") {
        state = { ...state, startLevel: settings.startLevel };
      }
      render();
      persist(true);
      break;
    case "pause":
      play("pause");
      break;
    case "resume":
      // 快捷键在「未开始 / 已结束」时也走这条消息：统一按 start 处理。
      if (state.status === "paused") play("resume");
      else play("start");
      break;
    case "restart":
      play("restart");
      break;
    case "panic":
      if (state.status === "running") play("pause");
      render();
      persist(true);
      break;
    case "highScore":
      // 宿主只会在这两种情况下发这条消息：刷新记录、或清除记录。
      // 所以直接赋值，不能用 max —— 否则重置永远生效不了。
      highScore = Math.max(0, Math.trunc(message.value));
      state = { ...state, highScore };
      updateHud();
      break;
  }
});

window.addEventListener("keydown", (event) => {
  // 浏览器要求先有用户手势才允许出声。
  audio.unlock();

  const action = keyToAction(event, event.repeat);
  if (action === null) return;
  event.preventDefault();

  if (action === "panic") {
    panic();
    return;
  }
  if (action === "togglePause") {
    togglePause();
    return;
  }
  play(action);
});

window.addEventListener("keyup", (event) => {
  if (!isSoftDropKey(event.code)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  play("softDropOff");
});

// 面板 webview 的键盘焦点要靠点击/显式聚焦拿到；点一下面板就恢复。
document.addEventListener("mousedown", () => {
  window.focus();
  audio.unlock();
});

window.addEventListener("pagehide", () => audio.dispose());

/**
 * 宿主那边也会在失焦/切编辑器时发 pause，但那几条消息在 webview 被挂起时
 * 可能根本投递不到。这里再兜一层：webview 自己一失去焦点/被藏起来就先暂停，
 * 免得重新展开时发现方块已经自己掉下去了。
 */
function pauseIfRunning(): void {
  if (state.status === "running") play("pause");
}

window.addEventListener("blur", pauseIfRunning);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseIfRunning();
});

let lastFrame = performance.now();

function frame(now: number): void {
  const delta = Math.min(100, Math.max(0, now - lastFrame));
  lastFrame = now;

  if (clearAnimation) {
    // 冻结引擎，等消行动画走完。
    render();
  } else if (state.status === "running") {
    commit(tick(state, delta));
  }

  requestAnimationFrame(frame);
}

new ResizeObserver(() => render()).observe(boardWrap);

watchTheme(() => {
  palette = paletteFor(settings.skin);
  render();
});

updateHud();
render();
requestAnimationFrame(frame);
vscode.postMessage({ type: "ready" });
