import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { LeaderboardClient, type FetchLike } from "../leaderboard/client";
import { LocalBoard, type MementoLike } from "../leaderboard/localBoard";
import {
  clampScore,
  formatRankLine,
  normalizeEndpoint,
  normalizeNickname,
  parseSubmitResponse,
  parseTopResponse,
  reduceTopScores,
} from "../leaderboard/policy";
import type { LocalScore } from "../leaderboard/types";

test("endpoint 只接受 https，开发时允许本机 http", () => {
  const endpoint = normalizeEndpoint("https://example.com/tetris-api/");
  assert.equal(endpoint.ok, true);
  if (endpoint.ok) assert.equal(endpoint.value, "https://example.com/tetris-api");
  assert.equal(normalizeEndpoint("http://127.0.0.1:8787").ok, true);
  assert.equal(normalizeEndpoint("http://localhost:8787").ok, true);
  assert.equal(normalizeEndpoint("http://example.com").ok, false);
  assert.equal(normalizeEndpoint("https://example.com/?a=1").ok, false);
  assert.equal(normalizeEndpoint("").ok, false);
});

test("昵称清洗、截断与回退", () => {
  assert.equal(normalizeNickname("  A \u0000 B  ", "abcdef123456"), "A B");
  assert.equal(normalizeNickname("x".repeat(30), "abcdef123456"), "x".repeat(24));
  assert.equal(normalizeNickname("", "abcdef123456"), "Player-3456");
  assert.equal(normalizeNickname("   ", "abcdef123456"), "Player-3456");
});

test("成绩字段钳制", () => {
  assert.deepEqual(clampScore(1000, 10, 2), { score: 1000, lines: 10, level: 2 });
  assert.equal(clampScore(-1, 0, 1), null);
  assert.equal(clampScore(1.5, 0, 1), null);
  assert.equal(clampScore(0, -1, 1), null);
  assert.equal(clampScore(0, 0, 0), null);
  assert.equal(clampScore(0, 0, 16), null);
});

test("解析榜单与提交响应", () => {
  const top = parseTopResponse({
    entries: [{ rank: 1, nickname: "A", score: 10, lines: 1, level: 1, at: "2026-01-01T00:00:00Z" }],
    total: 3,
    updatedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(top.ok, true);
  if (top.ok) {
    assert.equal(top.value.entries.length, 1);
    assert.equal(top.value.total, 3);
  }

  assert.equal(parseTopResponse({ entries: [{ rank: 0 }] }).ok, false);
  assert.equal(parseSubmitResponse({ rank: 2, total: 5, best: 1000 }).ok, true);
  assert.equal(parseSubmitResponse({ rank: 0, total: 5, best: 1000 }).ok, false);
});

test("本地榜排序、截断", () => {
  const entries: LocalScore[] = Array.from({ length: 10 }, (_, i) => ({
    score: 100 + i,
    lines: i,
    level: 1,
    at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
  }));
  const next = reduceTopScores(entries, {
    score: 5000,
    lines: 50,
    level: 3,
    at: "2026-01-02T00:00:00Z",
  });
  assert.equal(next.length, 10);
  assert.equal(next[0]?.score, 5000);
  assert.equal(next[9]?.score, 101);
});

test("LocalBoard 记录与清空", () => {
  const store = new Map<string, unknown>();
  const memento: MementoLike = {
    get<T>(key: string, defaultValue: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    async update(key, value) {
      store.set(key, value);
    },
  };
  const board = new LocalBoard(memento);
  board.record({ score: 100, lines: 1, level: 1, at: "2026-01-01T00:00:00Z" });
  board.record({ score: 300, lines: 3, level: 1, at: "2026-01-02T00:00:00Z" });
  assert.deepEqual(board.get().map((entry) => entry.score), [300, 100]);
  board.reset();
  assert.deepEqual(board.get(), []);
});

test("client 正常与异常响应", async () => {
  const okFetch: FetchLike = async () =>
    new Response(JSON.stringify({ entries: [], total: 0, updatedAt: "x" }), { status: 200 });
  const ok = await new LeaderboardClient("https://example.com", okFetch).fetchTop();
  assert.equal(ok.ok, true);

  const httpFetch: FetchLike = async () => new Response("nope", { status: 500 });
  const http = await new LeaderboardClient("https://example.com", httpFetch).fetchTop();
  assert.equal(http.ok, false);
  if (!http.ok) {
    assert.equal(http.error.kind, "http");
    assert.equal(http.error.status, 500);
  }

  const badFetch: FetchLike = async () => new Response("{", { status: 200 });
  const bad = await new LeaderboardClient("https://example.com", badFetch).fetchTop();
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.kind, "malformed");

  const netFetch: FetchLike = async () => {
    throw new Error("offline");
  };
  const net = await new LeaderboardClient("https://example.com", netFetch).fetchTop();
  assert.equal(net.ok, false);
  if (!net.ok) assert.equal(net.error.kind, "network");
});

test("client 与本机 HTTP 服务联调", async () => {
  let posted: unknown;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") {
        posted = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.end(JSON.stringify({ rank: 1, total: 1, best: 1000 }));
      } else {
        res.end(JSON.stringify({ entries: [], total: 0, updatedAt: "x" }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const client = new LeaderboardClient(`http://127.0.0.1:${port}`);
    const top = await client.fetchTop();
    assert.equal(top.ok, true);

    const submit = await client.submit({
      playerId: "abcdef12-3456-7890-abcd-ef1234567890",
      nickname: "Tester",
      score: 1000,
      lines: 10,
      level: 2,
      extensionVersion: "0.5.0",
    });
    assert.equal(submit.ok, true);
    assert.deepEqual(posted, {
      playerId: "abcdef12-3456-7890-abcd-ef1234567890",
      nickname: "Tester",
      score: 1000,
      lines: 10,
      level: 2,
      extensionVersion: "0.5.0",
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("排名文案", () => {
  assert.equal(formatRankLine(3, 12), "全球第 3 / 共 12 人");
  assert.equal(formatRankLine(1, 0), "");
});
