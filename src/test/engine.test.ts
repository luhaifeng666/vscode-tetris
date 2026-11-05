import assert from "node:assert/strict";
import { test } from "node:test";

import { applyInput, createGame, tick } from "../game/engine";
import { COLS, ROWS, type GameState } from "../game/types";

function baseState(): GameState {
  return createGame({ seed: 2026, startLevel: 1, highScore: 0 });
}

function running(): GameState {
  return applyInput(baseState(), "start").state;
}

function emptyBoard(): Uint8Array {
  return new Uint8Array(COLS * ROWS);
}

function fillRow(board: Uint8Array, y: number, fromX = 0, toX = COLS - 1): void {
  for (let x = fromX; x <= toX; x++) board[y * COLS + x] = 1;
}

test("新游戏处于 idle，方块贴顶、无分数", () => {
  const state = baseState();
  assert.equal(state.status, "idle");
  assert.equal(state.active?.y, 0);
  assert.equal(state.score, 0);
  assert.equal(state.lines, 0);
  assert.equal(state.level, 1);
});

test("start 进入 running，pause 后 tick 与移动都无效", () => {
  let state = running();
  assert.equal(state.status, "running");

  state = applyInput(state, "pause").state;
  assert.equal(state.status, "paused");

  const ticked = tick(state, 5000);
  assert.equal(ticked.state, state);

  const moved = applyInput(state, "left").state;
  assert.deepEqual(moved.active, state.active);
});

test("一直向左会停在左墙而不是穿墙", () => {
  let state = running();
  for (let i = 0; i < 20; i++) {
    state = applyInput(state, "left").state;
  }
  assert.equal(state.active?.x, 0);
});

test("硬降落到底行并按每格 2 分计分", () => {
  let state = running();
  state = {
    ...state,
    board: emptyBoard(),
    active: { kind: "I", rotation: 0, x: 0, y: 0 },
  };

  const result = applyInput(state, "hardDrop");
  assert.equal(result.state.board[(ROWS - 1) * COLS + 0], 1);
  assert.equal(result.state.board[(ROWS - 1) * COLS + 3], 1);
  assert.equal(result.state.score, (ROWS - 1) * 2);
  assert.ok(result.events.some((event) => event.type === "lock"));
});

test("消一行：清空该行并加 100 分", () => {
  let state = running();
  const board = emptyBoard();
  fillRow(board, ROWS - 1, 4);
  state = {
    ...state,
    board,
    score: 0,
    lines: 0,
    active: { kind: "I", rotation: 0, x: 0, y: 0 },
  };

  const result = applyInput(state, "hardDrop");
  const cleared = result.events.find((event) => event.type === "lineClear");
  assert.ok(cleared && cleared.type === "lineClear");
  assert.equal(cleared.count, 1);
  assert.equal(cleared.gained, 100);
  assert.deepEqual([...cleared.rows], [ROWS - 1]);
  // 动画用的快照应包含刚落下的 I，而不是消行后的空棋盘。
  assert.equal(cleared.board[(ROWS - 1) * COLS], 1);
  assert.equal(result.state.lines, 1);
  // 硬降 19 格 ×2 + 消行 100
  assert.equal(result.state.score, (ROWS - 1) * 2 + 100);
  for (let x = 0; x < COLS; x++) {
    assert.equal(result.state.board[(ROWS - 1) * COLS + x], 0);
  }
});

test("消两行（O 块补两个洞）", () => {
  let state = running();
  const board = emptyBoard();
  fillRow(board, ROWS - 2, 2);
  fillRow(board, ROWS - 1, 2);
  state = {
    ...state,
    board,
    active: { kind: "O", rotation: 0, x: 0, y: 0 },
  };

  const result = applyInput(state, "hardDrop");
  const cleared = result.events.find((event) => event.type === "lineClear");
  assert.ok(cleared && cleared.type === "lineClear");
  assert.equal(cleared.count, 2);
  assert.equal(cleared.gained, 300);
  assert.deepEqual([...cleared.rows], [ROWS - 2, ROWS - 1]);
  assert.equal(result.state.lines, 2);
});

test("消四行（竖 I）", () => {
  let state = running();
  const board = emptyBoard();
  for (let y = ROWS - 4; y < ROWS; y++) fillRow(board, y, 1);
  state = {
    ...state,
    board,
    active: { kind: "I", rotation: 1, x: 0, y: 0 },
  };

  const result = applyInput(state, "hardDrop");
  const cleared = result.events.find((event) => event.type === "lineClear");
  assert.ok(cleared && cleared.type === "lineClear");
  assert.equal(cleared.count, 4);
  assert.equal(cleared.gained, 800);
  assert.deepEqual([...cleared.rows], [ROWS - 4, ROWS - 3, ROWS - 2, ROWS - 1]);
  assert.equal(result.state.lines, 4);
});

test("累计十行升级，计分仍用升级前的等级", () => {
  let state = running();
  const board = emptyBoard();
  fillRow(board, ROWS - 1, 4);
  state = {
    ...state,
    board,
    lines: 9,
    level: 1,
    active: { kind: "I", rotation: 0, x: 0, y: 0 },
  };

  const result = applyInput(state, "hardDrop");
  assert.equal(result.state.lines, 10);
  assert.equal(result.state.level, 2);
  assert.ok(result.events.some((event) => event.type === "levelUp" && event.level === 2));
  const cleared = result.events.find((event) => event.type === "lineClear");
  assert.equal(cleared?.type === "lineClear" ? cleared.gained : 0, 100);
});

test("新方块出生位置被占则 game over", () => {
  let state = running();
  const board = emptyBoard();
  // 填满第一行但留一格，避免它被当成完整行消掉；同时挡住所有居中出生的方块。
  fillRow(board, 0, 0, COLS - 2);
  state = {
    ...state,
    board,
    active: { kind: "O", rotation: 0, x: 0, y: 1 },
  };

  const result = applyInput(state, "hardDrop");
  assert.equal(result.state.status, "gameOver");
  assert.equal(result.state.active, null);
  assert.ok(result.events.some((event) => event.type === "gameOver"));
  assert.ok(result.state.highScore >= result.state.score);
});

test("软降每格 +1 分，且使用 50ms 间隔", () => {
  let state = running();
  state = {
    ...state,
    board: emptyBoard(),
    active: { kind: "O", rotation: 0, x: 0, y: 0 },
  };
  state = applyInput(state, "softDropOn").state;

  const result = tick(state, 50);
  assert.equal(result.state.active?.y, 1);
  assert.equal(result.state.score, 1);
});

test("restart 重置分数与棋盘并直接开始", () => {
  let state = running();
  state = applyInput(state, "hardDrop").state;

  const restarted = applyInput(state, "restart").state;
  assert.equal(restarted.status, "running");
  assert.equal(restarted.score, 0);
  assert.equal(restarted.lines, 0);
  assert.equal(restarted.board.every((cell) => cell === 0), true);
});

test("同种子重放得到完全一致的状态", () => {
  function play(seed: number): GameState {
    let state = createGame({ seed, startLevel: 1, highScore: 0 });
    state = applyInput(state, "start").state;
    for (let frame = 0; frame < 300; frame++) {
      state = tick(state, 16).state;
      if (frame % 7 === 0) state = applyInput(state, "left").state;
      if (frame % 11 === 0) state = applyInput(state, "rotateCW").state;
      if (frame % 23 === 0) state = applyInput(state, "hardDrop").state;
    }
    return state;
  }

  assert.deepEqual(play(7), play(7));
  assert.notDeepEqual(play(7), play(8));
});
