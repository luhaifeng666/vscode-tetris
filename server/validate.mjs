export const MAX_BODY_BYTES = 4096;
export const MAX_NICKNAME_CODEPOINTS = 24;

const PLAYER_ID = /^[0-9a-fA-F-]{8,64}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const CONTROLS = /[\u0000-\u001F\u007F​-‍﻿]/g;

export function sanitizeNickname(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(CONTROLS, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const codepoints = [...cleaned];
  if (codepoints.length > MAX_NICKNAME_CODEPOINTS) return null;
  return cleaned;
}

export function validateScorePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }

  const { playerId, nickname, score, lines, level, extensionVersion } = body;

  if (typeof playerId !== "string" || !PLAYER_ID.test(playerId)) {
    return { ok: false, error: "invalid_player" };
  }

  const name = sanitizeNickname(nickname);
  if (name === null) return { ok: false, error: "invalid_nickname" };

  if (!Number.isInteger(score) || score < 0 || score > 10_000_000) {
    return { ok: false, error: "invalid_score" };
  }
  if (!Number.isInteger(lines) || lines < 0 || lines > 1_000_000) {
    return { ok: false, error: "invalid_lines" };
  }
  if (!Number.isInteger(level) || level < 1 || level > 15) {
    return { ok: false, error: "invalid_level" };
  }

  const version =
    typeof extensionVersion === "string" && VERSION.test(extensionVersion)
      ? extensionVersion
      : "unknown";

  return {
    ok: true,
    value: { playerId, nickname: name, score, lines, level, extensionVersion: version },
  };
}
