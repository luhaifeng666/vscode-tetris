import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLeaderboardServer } from "../server.mjs";

async function start(dataFile, options = {}) {
  const dir = dataFile ? null : await mkdtemp(join(tmpdir(), "tetris-leaderboard-"));
  const file = dataFile ?? join(dir, "scores.json");
  const app = await createLeaderboardServer({ dataFile: file, ...options });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return {
    app,
    dataFile: file,
    dir,
    base: `http://127.0.0.1:${address.port}`,
    async stop() {
      await app.close();
      if (dir) await rm(dir, { recursive: true, force: true });
    },
  };
}

function payload(overrides = {}) {
  return {
    playerId: randomUUID(),
    nickname: "Player-3F2A",
    score: 1000,
    lines: 10,
    level: 2,
    extensionVersion: "0.5.0",
    ...overrides,
  };
}

async function post(base, body, ip) {
  const headers = { "content-type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  const response = await fetch(`${base}/v1/scores`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function top(base) {
  const response = await fetch(`${base}/v1/top`);
  return { status: response.status, body: await response.json() };
}

test("health 与空榜", async () => {
  const env = await start();
  try {
    const health = await fetch(`${env.base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const result = await top(env.base);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.entries, []);
    assert.equal(result.body.total, 0);
  } finally {
    await env.stop();
  }
});

test("提交成绩后进入榜单", async () => {
  const env = await start();
  try {
    const result = await post(env.base, payload({ score: 1200 }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { rank: 1, total: 1, best: 1200 });

    const board = await top(env.base);
    assert.equal(board.body.total, 1);
    assert.equal(board.body.entries[0].rank, 1);
    assert.equal(board.body.entries[0].score, 1200);
    assert.equal(board.body.entries[0].nickname, "Player-3F2A");
  } finally {
    await env.stop();
  }
});

test("同一玩家只占一个名额并保留最高分", async () => {
  // 这个用例专门测存储层去重，关闭玩家级限流以免被 429 挡住。
  const env = await start(undefined, { playerWindowMs: 0 });
  try {
    const playerId = randomUUID();
    const first = await post(env.base, payload({ playerId, score: 900 }));
    assert.equal(first.body.best, 900);

    const lower = await post(env.base, payload({ playerId, score: 500 }));
    assert.equal(lower.body.best, 900);
    assert.equal(lower.body.total, 1);

    const higher = await post(env.base, payload({ playerId, score: 1500 }));
    assert.equal(higher.body.best, 1500);
    assert.equal(higher.body.total, 1);

    const board = await top(env.base);
    assert.equal(board.body.entries.length, 1);
    assert.equal(board.body.entries[0].score, 1500);
  } finally {
    await env.stop();
  }
});

test("并列分数共享名次", async () => {
  const env = await start();
  try {
    await post(env.base, payload({ nickname: "A", score: 800 }));
    await post(env.base, payload({ nickname: "B", score: 800 }));
    await post(env.base, payload({ nickname: "C", score: 500 }));

    const board = await top(env.base);
    assert.deepEqual(
      board.body.entries.map((entry) => [entry.rank, entry.score]),
      [
        [1, 800],
        [1, 800],
        [3, 500],
      ],
    );
  } finally {
    await env.stop();
  }
});

test("非法字段返回 400", async () => {
  const env = await start();
  try {
    const cases = [
      payload({ playerId: "x" }),
      payload({ nickname: "" }),
      payload({ nickname: "x".repeat(25) }),
      payload({ score: -1 }),
      payload({ score: 1.5 }),
      payload({ lines: -1 }),
      payload({ level: 0 }),
      payload({ level: 16 }),
    ];
    for (const [index, body] of cases.entries()) {
      // 每个用例换一个来源 IP，避免不同用例之间互相触发 IP 限流。
      const result = await post(env.base, body, `10.1.0.${index + 1}`);
      assert.equal(result.status, 400, JSON.stringify(body));
    }

    const badJson = await fetch(`${env.base}/v1/scores`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.1" },
      body: "{",
    });
    assert.equal(badJson.status, 400);

    const badType = await fetch(`${env.base}/v1/scores`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-forwarded-for": "10.2.0.2" },
      body: JSON.stringify(payload()),
    });
    assert.equal(badType.status, 400);
  } finally {
    await env.stop();
  }
});

test("同一玩家 10 秒内不能重复提交", async () => {
  const env = await start();
  try {
    const playerId = randomUUID();
    const first = await post(env.base, payload({ playerId }));
    assert.equal(first.status, 200);
    const second = await post(env.base, payload({ playerId, score: 2000 }));
    assert.equal(second.status, 429);
  } finally {
    await env.stop();
  }
});

test("IP 级 POST 限流 6 次/分钟", async () => {
  const env = await start();
  try {
    for (let i = 0; i < 6; i++) {
      const result = await post(env.base, payload({ score: 100 + i }));
      assert.equal(result.status, 200, `request ${i + 1}`);
    }
    const blocked = await post(env.base, payload({ score: 999 }));
    assert.equal(blocked.status, 429);
  } finally {
    await env.stop();
  }
});

test("数据持久化到 JSON 文件", async () => {
  const env = await start();
  try {
    await post(env.base, payload({ nickname: "Persisted", score: 4321 }));
    await env.app.close();

    const reopened = await createLeaderboardServer({ dataFile: env.dataFile });
    const address = await reopened.listen({ port: 0, host: "127.0.0.1" });
    const board = await top(`http://127.0.0.1:${address.port}`);
    assert.equal(board.body.total, 1);
    assert.equal(board.body.entries[0].nickname, "Persisted");
    assert.equal(board.body.entries[0].score, 4321);
    await reopened.close();
  } finally {
    await env.stop();
  }
});
