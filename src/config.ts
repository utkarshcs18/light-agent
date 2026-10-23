/**
 * Environment and the named-bulb registry (lights.json).
 * A missing .env is fine: the spoken demo compiles without an API key.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeviceInfo } from "./types.js";

try {
  process.loadEnvFile();
} catch {
  // Optional. Open-ended sentences need ANTHROPIC_API_KEY; the demo phrases do not.
}

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
export const CONNECTOR: "mock" | "kasa" = process.env.LIGHT_CONNECTOR === "kasa" ? "kasa" : "mock";
export const PORT = Number(process.env.PORT || 8787);

const LIGHTS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "lights.json");

export function loadLights(): DeviceInfo[] {
  if (!existsSync(LIGHTS_FILE)) return [];
  return JSON.parse(readFileSync(LIGHTS_FILE, "utf-8")) as DeviceInfo[];
}

export function saveLights(lights: DeviceInfo[]): void {
  writeFileSync(LIGHTS_FILE, JSON.stringify(lights, null, 2), "utf-8");
}
