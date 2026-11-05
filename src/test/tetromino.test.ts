import assert from "node:assert/strict";
import { test } from "node:test";

import { SHAPES, spawnPiece, tryRotate, collides } from "../game/tetromino";
import { COLS, PIECE_KINDS, type Rotation } from "../game/types";

test("每种方块都有四个旋转态，且每态都是四格", () => {
  for (const kind of PIECE_KINDS) {
    const shapes = SHAPES[kind];
    assert.equal(shapes.length, 4, `${kind} 的旋转态数量`);
    for (const shape of shapes) {
      assert.equal(shape.cells.length, 4, `${kind} 的格子数`);
    }
  }
});

test("旋转态坐标都在包围盒内", () => {
  for (const kind of PIECE_KINDS) {
    for (const shape of SHAPES[kind]) {
      for (const [x, y] of shape.cells) {
        assert.ok(x >= 0 && x < shape.width, `${kind} x 越界`);
        assert.ok(y >= 0 && y < shape.height, `${kind} y 越界`);
      }
    }
  }
});

test("O 旋转后形状不变", () => {
  // 旋转会重排 cell 顺序，比较坐标集合而不是数组顺序。
  const footprint = (shape: { cells: readonly (readonly [number, number])[] }): string =>
    shape.cells
      .map(([x, y]) => `${x},${y}`)
      .sort()
      .join("|");

  const first = footprint(SHAPES.O[0]!);
  for (const shape of SHAPES.O) {
    assert.equal(footprint(shape), first);
  }
});

test("I 在横竖两种包围盒之间交替", () => {
  assert.equal(SHAPES.I[0]!.width, 4);
  assert.equal(SHAPES.I[0]!.height, 1);
  assert.equal(SHAPES.I[1]!.width, 1);
  assert.equal(SHAPES.I[1]!.height, 4);
});

test("出生位置水平居中且贴顶", () => {
  for (const kind of PIECE_KINDS) {
    const piece = spawnPiece(kind);
    const shape = SHAPES[kind][0]!;
    assert.equal(piece.y, 0);
    assert.equal(piece.x + shape.width <= COLS, true);
    assert.equal(piece.x >= 0, true);
  }
});

test("贴左墙旋转会被墙踢推开，而不是失败", () => {
  const board = new Uint8Array(COLS * 20);
  const piece = { kind: "T" as const, rotation: 0 as Rotation, x: 0, y: 5 };
  const rotated = tryRotate(board, piece, 1);
  assert.notEqual(rotated, null);
  assert.ok(collides(board, rotated!) === false);
});

test("棋盘中央旋转保持原位", () => {
  const board = new Uint8Array(COLS * 20);
  const piece = { kind: "T" as const, rotation: 0 as Rotation, x: 4, y: 10 };
  const rotated = tryRotate(board, piece, 1);
  assert.deepEqual(rotated, { ...piece, rotation: 1 });
});
