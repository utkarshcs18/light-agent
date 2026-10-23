/**
 * presence.ts - the room the agent keeps.
 *
 * "I'm leaving" stores every bulb and a loop that turns them back off.
 * "I'm back" restores that room. The file survives a process restart.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const AWAY_MARK = "presence:away";
export const AWAY_EVERY_MS = 5_000;

export interface PresenceSceneLight {
  id: string;
  power: "on" | "off";
  brightness?: number;
  hue?: number;
  saturation?: number;
}

export interface PresenceState {
  mode: "home" | "away";
  since?: string;
  scene: PresenceSceneLight[];
}

const DEFAULT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "presence.json");

function presenceFile(): string {
  return process.env.PRESENCE_FILE || DEFAULT_FILE;
}

export function loadPresence(): PresenceState {
  const file = presenceFile();
  if (!existsSync(file)) return { mode: "home", scene: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<PresenceState>;
    const mode = parsed.mode === "away" ? "away" : "home";
    const scene = Array.isArray(parsed.scene) ? parsed.scene.filter((light) => light && light.id) : [];
    return { mode, since: parsed.since, scene };
  } catch {
    return { mode: "home", scene: [] };
  }
}

export function savePresence(state: PresenceState): void {
  writeFileSync(presenceFile(), JSON.stringify(state, null, 2), "utf-8");
}
