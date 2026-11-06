export interface LeaderboardEntry {
  readonly rank: number;
  readonly nickname: string;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly at: string;
}

export interface LeaderboardTop {
  readonly entries: readonly LeaderboardEntry[];
  readonly total: number;
  readonly updatedAt: string;
}

export interface ScoreSubmission {
  readonly playerId: string;
  readonly nickname: string;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly extensionVersion: string;
}

export interface SubmitOutcome {
  readonly rank: number;
  readonly total: number;
  readonly best: number;
}

export type LeaderboardErrorKind =
  | "network"
  | "timeout"
  | "http"
  | "malformed"
  | "disabled"
  | "not-consented"
  | "busy"
  | "invalid";

export interface LeaderboardError {
  readonly kind: LeaderboardErrorKind;
  readonly status?: number;
  readonly message?: string;
}

export type LeaderboardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LeaderboardError };

export interface LocalScore {
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly at: string;
}
