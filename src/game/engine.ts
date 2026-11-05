import { nextRandom, normalizeSeed } from "./rng";
import { dropIntervalMs, levelForLines, scoreForLines } from "./scoring";
import { collides, shapeAt, spawnPiece, tryRotate } from "./tetromino";
import {
  COLS,
  PIECE_INDEX,
  PIECE_KINDS,
  ROWS,
  type GameEvent,
  type GameState,
  type GameStatus,
  type Input,
  type PieceKind,
  type StepResult,
} from "./types";

export interface CreateGameOptions {
  readonly seed: number;
  readonly startLevel: number;
  readonly highScore: number;
}

/** 每帧最多推进 1 秒，防止休眠回来时一次掉一大截。 */
const MAX_TICK_MS = 1000;
/** 一帧里允许的连锁下落次数上限，纯粹是防御死循环。 */
const MAX_STEPS_PER_TICK = 64;

function clampStartLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(10, Math.max(1, Math.floor(level)));
}

function drawPiece(rngState: number): { kind: PieceKind; state: number } {
  const next = nextRandom(rngState);
  const index = Math.min(PIECE_KINDS.length - 1, Math.floor(next.value * PIECE_KINDS.length));
  return { kind: PIECE_KINDS[index]!, state: next.state };
}

function emptyBoard(): Uint8Array {
  return new Uint8Array(COLS * ROWS);
}

function statusEvent(status: GameStatus): GameEvent {
  return { type: "statusChanged", status };
}

function buildGame(options: CreateGameOptions, status: GameStatus): GameState {
  const startLevel = clampStartLevel(options.startLevel);
  const first = drawPiece(normalizeSeed(options.seed));
  const second = drawPiece(first.state);

  return {
    board: emptyBoard(),
    active: spawnPiece(first.kind),
    next: second.kind,
    score: 0,
    lines: 0,
    level: startLevel,
    startLevel,
    status,
    dropAccumulator: 0,
    softDropping: false,
    rngState: second.state,
    highScore: Math.max(0, Math.trunc(options.highScore)),
  };
}

export function createGame(options: CreateGameOptions): GameState {
  return buildGame(options, "idle");
}

function restart(state: GameState): StepResult {
  // 用当前随机源做新种子：连续重开不会拿到同一组方块序列。
  const fresh = buildGame(
    { seed: state.rngState, startLevel: state.startLevel, highScore: state.highScore },
    "running",
  );
  return { state: fresh, events: [statusEvent("running")] };
}

function move(state: GameState, deltaX: number): StepResult {
  const active = state.active;
  if (!active) return { state, events: [] };

  const moved = { ...active, x: active.x + deltaX };
  if (collides(state.board, moved)) return { state, events: [] };
  return { state: { ...state, active: moved }, events: [] };
}

function rotate(state: GameState, direction: 1 | -1): StepResult {
  const active = state.active;
  if (!active) return { state, events: [] };

  const rotated = tryRotate(state.board, active, direction);
  if (!rotated) return { state, events: [] };
  return { state: { ...state, active: rotated }, events: [] };
}

function hardDrop(state: GameState): StepResult {
  const active = state.active;
  if (!active) return { state, events: [] };

  let y = active.y;
  let dropped = 0;
  while (!collides(state.board, { ...active, y: y + 1 })) {
    y++;
    dropped++;
  }

  return lock(
    { ...state, active: { ...active, y }, score: state.score + dropped * 2 },
    [],
  );
}

/**
 * 把当前方块写进棋盘、消行、换下一块。
 *
 * 锁定后不保留任何「提前量」，dropAccumulator 归零：新方块从完整的一个
 * 重力间隔开始，否则高等级下新块会刚出现就往下跳一格。
 */
function lock(state: GameState, events: GameEvent[]): StepResult {
  const active = state.active;
  if (!active) return { state, events };

  const board = state.board.slice();
  for (const [cellX, cellY] of shapeAt(active.kind, active.rotation).cells) {
    const x = active.x + cellX;
    const y = active.y + cellY;
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
      board[y * COLS + x] = PIECE_INDEX[active.kind];
    }
  }
  events.push({ type: "lock" });

  const fullRows: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    let full = true;
    for (let x = 0; x < COLS; x++) {
      if (board[y * COLS + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) fullRows.push(y);
  }

  let nextBoard = board;
  if (fullRows.length > 0) {
    // 从下往上把非满行搬下来，剩下的自然就是空行。
    nextBoard = new Uint8Array(board.length);
    let writeY = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (fullRows.includes(y)) continue;
      nextBoard.set(board.subarray(y * COLS, y * COLS + COLS), writeY * COLS);
      writeY--;
    }
  }

  let score = state.score;
  let lines = state.lines;
  let level = state.level;

  if (fullRows.length > 0) {
    const gained = scoreForLines(fullRows.length, state.level);
    score += gained;
    lines += fullRows.length;
    level = levelForLines(lines, state.startLevel);
    events.push({
      type: "lineClear",
      count: fullRows.length,
      gained,
      rows: fullRows,
      // nextBoard 是新数组，这里的 board 不会被后续修改，可以直接交给界面。
      board,
    });
    if (level !== state.level) events.push({ type: "levelUp", level });
  }

  const drawn = drawPiece(state.rngState);
  const spawned = spawnPiece(state.next);
  const shared = {
    ...state,
    board: nextBoard,
    next: drawn.kind,
    score,
    lines,
    level,
    rngState: drawn.state,
    dropAccumulator: 0,
  };

  if (collides(nextBoard, spawned)) {
    const highScore = Math.max(state.highScore, score);
    events.push({ type: "gameOver", score }, statusEvent("gameOver"));
    return {
      state: { ...shared, active: null, status: "gameOver", highScore, softDropping: false },
      events,
    };
  }

  return { state: { ...shared, active: spawned }, events };
}

export function applyInput(state: GameState, input: Input): StepResult {
  switch (input) {
    case "start":
      if (state.status === "running") return { state, events: [] };
      if (state.status === "gameOver") return restart(state);
      return {
        state: { ...state, status: "running", dropAccumulator: 0 },
        events: [statusEvent("running")],
      };

    case "pause":
      if (state.status !== "running") return { state, events: [] };
      return {
        state: { ...state, status: "paused", softDropping: false },
        events: [statusEvent("paused")],
      };

    case "resume":
      if (state.status !== "paused") return { state, events: [] };
      return {
        state: { ...state, status: "running", dropAccumulator: 0 },
        events: [statusEvent("running")],
      };

    case "restart":
      return restart(state);

    case "softDropOn":
      if (state.status !== "running") return { state, events: [] };
      return { state: { ...state, softDropping: true }, events: [] };

    case "softDropOff":
      return { state: { ...state, softDropping: false }, events: [] };

    default:
      break;
  }

  if (state.status !== "running" || state.active === null) {
    return { state, events: [] };
  }

  switch (input) {
    case "left":
      return move(state, -1);
    case "right":
      return move(state, 1);
    case "rotateCW":
      return rotate(state, 1);
    case "rotateCCW":
      return rotate(state, -1);
    case "hardDrop":
      return hardDrop(state);
    default:
      return { state, events: [] };
  }
}

export function tick(state: GameState, deltaMs: number): StepResult {
  if (state.status !== "running" || state.active === null) {
    return { state, events: [] };
  }

  const events: GameEvent[] = [];
  let current = state;
  let accumulator =
    state.dropAccumulator + Math.min(MAX_TICK_MS, Math.max(0, deltaMs));

  for (let step = 0; step < MAX_STEPS_PER_TICK; step++) {
    const interval = dropIntervalMs(current.level, current.softDropping);
    if (accumulator < interval) break;

    const active = current.active;
    if (!active) break;

    const down = { ...active, y: active.y + 1 };
    if (collides(current.board, down)) {
      current = lock(current, events).state;
      accumulator = 0;
      break;
    }

    accumulator -= interval;
    current = {
      ...current,
      active: down,
      // 软降每主动下降一格 +1 分，和经典规则一致。
      score: current.softDropping ? current.score + 1 : current.score,
    };
  }

  return { state: { ...current, dropAccumulator: accumulator }, events };
}
