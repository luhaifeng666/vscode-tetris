import * as vscode from "vscode";

import { FIELDS_VERSION, type Consent } from "./service";

const CONSENT_KEY = "tetris.leaderboardConsent";

export function readConsent(context: vscode.ExtensionContext): Consent | undefined {
  const raw = context.globalState.get<unknown>(CONSENT_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const data = raw as Record<string, unknown>;
  if (
    typeof data.endpoint !== "string" ||
    typeof data.acceptedAt !== "string" ||
    data.fieldsVersion !== FIELDS_VERSION
  ) {
    return undefined;
  }
  return {
    endpoint: data.endpoint,
    fieldsVersion: FIELDS_VERSION,
    acceptedAt: data.acceptedAt,
  };
}

export function writeConsent(context: vscode.ExtensionContext, endpoint: string): void {
  void context.globalState.update(CONSENT_KEY, {
    endpoint,
    fieldsVersion: FIELDS_VERSION,
    acceptedAt: new Date().toISOString(),
  });
}
