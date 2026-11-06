import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

const PLAYER_ID_KEY = "tetris.playerId";
const PLAYER_ID = /^[0-9a-fA-F-]{8,64}$/;

export async function getOrCreatePlayerId(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  try {
    const existing = await context.secrets.get(PLAYER_ID_KEY);
    if (typeof existing === "string" && PLAYER_ID.test(existing)) return existing;

    const created = randomUUID();
    await context.secrets.store(PLAYER_ID_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}
