import type {
  LeaderboardEntry,
  LeaderboardResult,
  LeaderboardTop,
  LocalScore,
  ScoreSubmission,
  SubmitOutcome,
} from "./types";

export const MAX_NICKNAME_CODEPOINTS = 24;
export const MAX_SCORE = 10_000_000;
export const MAX_LINES = 1_000_000;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 15;

const CONTROLS = /[\u0000-\u001F\u007F​-‍﻿]/g;

function invalid(message: string): LeaderboardResult<never> {
  return { ok: false, error: { kind: "invalid", message } };
}

function isInt(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 只允许 https；本地调试放行 http://127.0.0.1 / localhost。
 * 去掉 query/hash 和末尾斜杠，避免拼出奇怪的地址。
 */
export function normalizeEndpoint(raw: string): LeaderboardResult<string> {
  const trimmed = raw.trim();
  if (!trimmed) return invalid("empty endpoint");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return invalid("invalid endpoint");
  }

  const local =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return invalid("https required");
  }
  if (url.search || url.hash) return invalid("endpoint must not contain query or hash");

  url.pathname = url.pathname.replace(/\/+$/, "");
  return { ok: true, value: url.toString().replace(/\/+$/, "") };
}

export function endpointFor(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 去控制字符/零宽字符，折叠空白；不做空值回退。 */
export function cleanNickname(raw: string): string {
  return raw.replace(CONTROLS, "").replace(/\s+/g, " ").trim();
}

export function normalizeNickname(raw: string, playerId: string): string {
  const cleaned = cleanNickname(raw);
  const codepoints = [...cleaned].slice(0, MAX_NICKNAME_CODEPOINTS).join("");
  if (codepoints) return codepoints;

  const suffix =
    playerId.replace(/[^0-9a-zA-Z]/g, "").slice(-4).toUpperCase() || "????";
  return `Player-${suffix}`;
}

export function clampScore(
  score: unknown,
  lines: unknown,
  level: unknown,
): { score: number; lines: number; level: number } | null {
  if (!isInt(score, 0, MAX_SCORE)) return null;
  if (!isInt(lines, 0, MAX_LINES)) return null;
  if (!isInt(level, MIN_LEVEL, MAX_LEVEL)) return null;
  return { score, lines, level };
}

export function toSubmission(
  playerId: string,
  nickname: string,
  score: unknown,
  lines: unknown,
  level: unknown,
  extensionVersion: string,
): ScoreSubmission | null {
  const clamped = clampScore(score, lines, level);
  if (!clamped) return null;
  return {
    playerId,
    nickname: normalizeNickname(nickname, playerId),
    score: clamped.score,
    lines: clamped.lines,
    level: clamped.level,
    extensionVersion,
  };
}

export function parseTopResponse(raw: unknown): LeaderboardResult<LeaderboardTop> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: { kind: "malformed" } };
  }
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.entries)) {
    return { ok: false, error: { kind: "malformed" } };
  }

  const entries: LeaderboardEntry[] = [];
  for (const item of data.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: { kind: "malformed" } };
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.nickname !== "string" ||
      typeof entry.at !== "string" ||
      !isInt(entry.rank, 1) ||
      !isInt(entry.score, 0) ||
      !isInt(entry.lines, 0) ||
      !isInt(entry.level, MIN_LEVEL, MAX_LEVEL)
    ) {
      return { ok: false, error: { kind: "malformed" } };
    }
    entries.push({
      rank: entry.rank,
      nickname: entry.nickname,
      score: entry.score,
      lines: entry.lines,
      level: entry.level,
      at: entry.at,
    });
  }

  const total = isInt(data.total, entries.length) ? data.total : entries.length;
  const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString();
  return { ok: true, value: { entries, total, updatedAt } };
}

export function parseSubmitResponse(raw: unknown): LeaderboardResult<SubmitOutcome> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: { kind: "malformed" } };
  }
  const data = raw as Record<string, unknown>;
  if (!isInt(data.rank, 1) || !isInt(data.total, 1) || !isInt(data.best, 0)) {
    return { ok: false, error: { kind: "malformed" } };
  }
  return { ok: true, value: { rank: data.rank, total: data.total, best: data.best } };
}

export function formatRankLine(rank: number, total: number): string {
  return total > 0 ? `全球第 ${rank} / 共 ${total} 人` : "";
}

export function reduceTopScores(
  existing: readonly LocalScore[],
  entry: LocalScore,
  limit = 10,
): LocalScore[] {
  return [...existing, entry]
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
    })
    .slice(0, Math.max(1, limit));
}
