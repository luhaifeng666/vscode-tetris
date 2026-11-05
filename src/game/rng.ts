/**
 * mulberry32：32 位确定性随机数。
 *
 * 状态随 GameState 一起传递，而不是模块级变量——这样同一个种子重放时
 * 每一步都完全一致，单元测试可以直接断言方块序列。
 */
export function nextRandom(state: number): { state: number; value: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

/** 种子为 0 时 mulberry32 会退化，换一个常数。 */
export function normalizeSeed(seed: number): number {
  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? 0x9e3779b9 : normalized;
}
