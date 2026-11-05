import assert from "node:assert/strict";
import { test } from "node:test";

import { nextRandom, normalizeSeed } from "../game/rng";
import { PIECE_KINDS } from "../game/types";

test("同一种子产生同一序列", () => {
  const first = nextRandom(42);
  const second = nextRandom(42);
  assert.deepEqual(first, second);
});

test("种子 0 会被替换成一个非零状态", () => {
  assert.notEqual(normalizeSeed(0), 0);
});

test("连续抽样能覆盖七种方块", () => {
  const seen = new Set<string>();
  let state = normalizeSeed(2026);
  for (let i = 0; i < 10000; i++) {
    const next = nextRandom(state);
    state = next.state;
    seen.add(PIECE_KINDS[Math.floor(next.value * PIECE_KINDS.length)]!);
  }
  assert.equal(seen.size, PIECE_KINDS.length);
});
