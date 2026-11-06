import { endpointFor, parseSubmitResponse, parseTopResponse } from "./policy";
import type {
  LeaderboardResult,
  LeaderboardTop,
  ScoreSubmission,
  SubmitOutcome,
} from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function malformed(): LeaderboardResult<never> {
  return { ok: false, error: { kind: "malformed" } };
}

/**
 * 只谈 HTTP；不依赖 vscode，fetch 可注入，方便单测。
 * 失败一律返回结果对象，不跨模块抛异常。
 */
export class LeaderboardClient {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  fetchTop(): Promise<LeaderboardResult<LeaderboardTop>> {
    return this.request("/v1/top", { method: "GET" }, parseTopResponse);
  }

  submit(payload: ScoreSubmission): Promise<LeaderboardResult<SubmitOutcome>> {
    return this.request(
      "/v1/scores",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      parseSubmitResponse,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (raw: unknown) => LeaderboardResult<T>,
  ): Promise<LeaderboardResult<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(endpointFor(this.base, path), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      return {
        ok: false,
        error: {
          kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
          message: String(error),
        },
      };
    }

    if (!response.ok) {
      return { ok: false, error: { kind: "http", status: response.status } };
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return malformed();
    }
    if (text.length > MAX_RESPONSE_BYTES) return malformed();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return malformed();
    }
    return parse(json);
  }
}
