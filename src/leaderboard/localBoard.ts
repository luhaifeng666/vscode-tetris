import { reduceTopScores } from "./policy";
import type { LocalScore } from "./types";

export const LOCAL_BOARD_KEY = "tetris.localTopScores";
export const LOCAL_BOARD_LIMIT = 10;

export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

function isScore(value: unknown): value is LocalScore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.score) &&
    Number.isInteger(entry.lines) &&
    Number.isInteger(entry.level) &&
    typeof entry.at === "string"
  );
}

/** 本地 TOP10 只是离线兜底和记录，不涉及隐私。每次 game over 都记。 */
export class LocalBoard {
  constructor(
    private readonly memento: MementoLike,
    private readonly key = LOCAL_BOARD_KEY,
  ) {}

  get(): LocalScore[] {
    const raw = this.memento.get<unknown>(this.key, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isScore).slice(0, LOCAL_BOARD_LIMIT);
  }

  record(entry: LocalScore): LocalScore[] {
    const next = reduceTopScores(this.get(), entry, LOCAL_BOARD_LIMIT);
    void this.memento.update(this.key, next);
    return next;
  }

  reset(): void {
    void this.memento.update(this.key, []);
  }
}
