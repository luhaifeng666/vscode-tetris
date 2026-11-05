import { MAX_LEVEL } from "./types";

const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800];

/** 计分只看「这次消了几行」和当前等级，不做 Combo / B2B。 */
export function scoreForLines(count: number, level: number): number {
  return (LINE_SCORES[count] ?? 0) * level;
}

export function levelForLines(lines: number, startLevel: number): number {
  return Math.min(MAX_LEVEL, startLevel + Math.floor(lines / 10));
}

/** 等级越高下落越快；软降固定 50ms，硬降是瞬时的。 */
export function dropIntervalMs(level: number, softDropping: boolean): number {
  if (softDropping) return 50;
  const clamped = Math.min(MAX_LEVEL, Math.max(1, level));
  return Math.max(80, Math.round(800 * Math.pow(0.85, clamped - 1)));
}
