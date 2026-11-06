import type { LeaderboardClient } from "./client";
import { normalizeNickname, toSubmission } from "./policy";
import type { LeaderboardResult, LeaderboardTop, SubmitOutcome } from "./types";

export const FIELDS_VERSION = 1;

export interface LeaderboardSettings {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly nickname: string;
}

export interface Consent {
  readonly endpoint: string;
  readonly fieldsVersion: number;
  readonly acceptedAt: string;
}

export interface LeaderboardServiceDeps {
  readonly getSettings: () => LeaderboardSettings;
  readonly getConsent: () => Consent | undefined;
  readonly getPlayerId: () => Promise<string | undefined>;
  readonly getVersion: () => string;
  readonly createClient: (endpoint: string) => LeaderboardClient;
  readonly log: { warn(message: string): void; info(message: string): void };
}

export type DeliverRank = (result: LeaderboardResult<SubmitOutcome>) => void;

/**
 * 上传门禁 + 单一 in-flight 请求。
 *
 * 上传条件是「开启 && 有 endpoint && 同意记录与当前 endpoint/字段版本一致」。
 * 只改设置而没有同意记录时不会上传，避免设置页绕过确认弹窗。
 */
export class LeaderboardService {
  private inFlight = false;

  constructor(private readonly deps: LeaderboardServiceDeps) {}

  canUpload(): boolean {
    const settings = this.deps.getSettings();
    const consent = this.deps.getConsent();
    return (
      settings.enabled &&
      settings.endpoint.length > 0 &&
      consent !== undefined &&
      consent.endpoint === settings.endpoint &&
      consent.fieldsVersion === FIELDS_VERSION
    );
  }

  async fetchTop(): Promise<LeaderboardResult<LeaderboardTop>> {
    const settings = this.deps.getSettings();
    if (!settings.endpoint) {
      return { ok: false, error: { kind: "disabled" } };
    }
    return this.deps.createClient(settings.endpoint).fetchTop();
  }

  async submit(
    score: number,
    lines: number,
    level: number,
    deliver: DeliverRank,
  ): Promise<void> {
    if (!this.canUpload()) return;

    const settings = this.deps.getSettings();
    if (this.inFlight) {
      this.deps.log.info("排行榜上一条成绩还在提交，跳过本次");
      return;
    }

    const playerId = await this.deps.getPlayerId();
    if (!playerId) {
      this.deps.log.warn("无法获取玩家 ID，跳过排行榜上传");
      return;
    }

    const submission = toSubmission(
      playerId,
      normalizeNickname(settings.nickname, playerId),
      score,
      lines,
      level,
      this.deps.getVersion(),
    );
    if (!submission) {
      this.deps.log.warn("成绩字段不合法，跳过排行榜上传");
      return;
    }

    this.inFlight = true;
    try {
      const result = await this.deps.createClient(settings.endpoint).submit(submission);
      if (!result.ok) {
        this.deps.log.warn(
          `排行榜上传失败：${result.error.kind}${
            result.error.status ? ` (${result.error.status})` : ""
          }`,
        );
      }
      deliver(result);
    } catch (error) {
      this.deps.log.warn(`排行榜上传异常：${String(error)}`);
      deliver({ ok: false, error: { kind: "network" } });
    } finally {
      this.inFlight = false;
    }
  }
}
