import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { RateLimiter } from "./ratelimit.mjs";
import { ScoreStore } from "./store.mjs";
import { MAX_BODY_BYTES, validateScorePayload } from "./validate.mjs";

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export async function createLeaderboardServer({
  dataFile,
  log = console,
  // 测试用：传 0 可关闭「同一玩家 10 秒一次」的限制。生产环境用默认值。
  playerWindowMs = 10_000,
} = {}) {
  if (!dataFile) throw new Error("dataFile is required");
  const store = new ScoreStore(dataFile);
  await store.load();

  const ipLimiter = new RateLimiter();
  const playerLimiter = new RateLimiter();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const ip = clientIp(req);

      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/v1/top" && req.method === "GET") {
        if (!ipLimiter.take(`get:${ip}`, 60, 60_000)) {
          send(res, 429, { error: "rate_limited" });
          return;
        }
        send(res, 200, {
          entries: store.top(10),
          total: store.total(),
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      if (url.pathname === "/v1/scores" && req.method === "POST") {
        if (!ipLimiter.take(`post:${ip}`, 6, 60_000)) {
          send(res, 429, { error: "rate_limited" });
          return;
        }

        const contentType = String(req.headers["content-type"] ?? "");
        if (!contentType.includes("application/json")) {
          send(res, 400, { error: "invalid_content_type" });
          return;
        }

        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          send(res, 400, { error: "invalid_json" });
          return;
        }

        const validated = validateScorePayload(body);
        if (!validated.ok) {
          send(res, 400, { error: validated.error });
          return;
        }

        if (
          playerWindowMs > 0 &&
          !playerLimiter.take(`player:${validated.value.playerId}`, 1, playerWindowMs)
        ) {
          send(res, 429, { error: "rate_limited" });
          return;
        }

        const result = await store.add(validated.value);
        send(res, 200, result);
        return;
      }

      if (url.pathname === "/v1/top" || url.pathname === "/v1/scores") {
        send(res, 405, { error: "method_not_allowed" });
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "internal_error";
      if (status >= 500) log.error?.(error);
      if (!res.headersSent) send(res, status, { error: code });
      else res.end();
    }
  });

  return {
    server,
    store,
    async listen({ port = 8787, host = "127.0.0.1" } = {}) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  const dataFile = process.env.DATA_FILE ?? join(dataDir, "scores.json");

  const app = await createLeaderboardServer({ dataFile });
  const address = await app.listen({ port, host });
  console.log(`leaderboard listening on http://${address.address}:${address.port}`);
  console.log(`data file: ${dataFile}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
