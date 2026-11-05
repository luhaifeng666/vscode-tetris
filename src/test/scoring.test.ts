import assert from "node:assert/strict";
import { test } from "node:test";

import { dropIntervalMs, levelForLines, scoreForLines } from "../game/scoring";

test("消行计分表按等级放大", () => {
  assert.equal(scoreForLines(0, 3), 0);
  assert.equal(scoreForLines(1, 3), 300);
  assert.equal(scoreForLines(2, 1), 300);
  assert.equal(scoreForLines(3, 2), 1000);
  assert.equal(scoreForLines(4, 1), 800);
  assert.equal(scoreForLines(4, 5), 4000);
});

test("每十行升一级，封顶 15", () => {
  assert.equal(levelForLines(0, 1), 1);
  assert.equal(levelForLines(9, 1), 1);
  assert.equal(levelForLines(10, 1), 2);
  assert.equal(levelForLines(25, 2), 4);
  assert.equal(levelForLines(1000, 1), 15);
});

test("等级越高下落越快，软降固定 50ms", () => {
  assert.equal(dropIntervalMs(1, false), 800);
  assert.ok(dropIntervalMs(5, false) < dropIntervalMs(1, false));
  // 0.85^14 会略微高于 80，max(80, …) 只是保底。
  assert.equal(dropIntervalMs(15, false), 82);
  assert.equal(dropIntervalMs(1, true), 50);
});
