import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sanitizeNickname } from "./validate.mjs";

function isEntry(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.playerId === "string" &&
    typeof value.nickname === "string" &&
    Number.isInteger(value.score) &&
    Number.isInteger(value.lines) &&
    Number.isInteger(value.level) &&
    typeof value.at === "string"
  );
}

function compare(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.playerId < b.playerId ? -1 : 1;
}

export class ScoreStore {
  constructor(file, limit = 200) {
    this.file = file;
    this.limit = limit;
    this.entries = [];
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8"));
      const entries = Array.isArray(raw?.entries) ? raw.entries : [];
      this.entries = entries
        .filter((entry) => isEntry(entry) && sanitizeNickname(entry.nickname) !== null)
        .map((entry) => ({ ...entry, nickname: sanitizeNickname(entry.nickname) }))
        .sort(compare)
        .slice(0, this.limit);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.entries = [];
    }
  }

  total() {
    return this.entries.length;
  }

  rankOf(score) {
    return 1 + this.entries.filter((entry) => entry.score > score).length;
  }

  top(limit = 10) {
    this.sort();
    return this.entries.slice(0, Math.max(1, limit)).map((entry) => ({
      rank: this.rankOf(entry.score),
      nickname: entry.nickname,
      score: entry.score,
      lines: entry.lines,
      level: entry.level,
      at: entry.at,
    }));
  }

  async add(payload) {
    this.sort();
    const index = this.entries.findIndex((entry) => entry.playerId === payload.playerId);
    const at = new Date().toISOString();

    if (index >= 0) {
      const existing = this.entries[index];
      if (payload.score <= existing.score) {
        return { rank: this.rankOf(existing.score), total: this.total(), best: existing.score };
      }
      this.entries[index] = { ...payload, at };
    } else {
      this.entries.push({ ...payload, at });
    }

    this.sort();
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    await this.persist();
    return { rank: this.rankOf(payload.score), total: this.total(), best: payload.score };
  }

  async close() {
    await this.writeChain;
  }

  sort() {
    this.entries.sort(compare);
  }

  persist() {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify({ entries: this.entries }, null, 2), "utf8");
      await rename(tmp, this.file);
    });
    return this.writeChain;
  }
}
