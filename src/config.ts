/**
 * config.ts - environment + persisted light registry.
 *
 * TODO:
 *   - Load .env via process.loadEnvFile() (wrap in try/catch; Node 24 built-in).
 *   - Export: ANTHROPIC_API_KEY, CLAUDE_MODEL (default e.g. "claude-sonnet-4-5"),
 *     CONNECTOR ("mock" | "kasa" from process.env.LIGHT_CONNECTOR).
 *   - loadLights(): DeviceInfo[]  -> read ./lights.json (return [] if missing).
 *   - saveLights(lights): void    -> write ./lights.json (used by setup.ts).
 *   - Resolve the lights.json path relative to this file (import.meta.url + node:path).
 *
 * Imports use .js extensions (NodeNext), e.g. import type { DeviceInfo } from "./types.js".
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DeviceInfo } from "./types.js";

// load vars from .env  file into process.env

try {
    process.loadEnvFile();

} catch {
    console.error("Error loading .env file");
}

// settings 

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-1776";
export const CONNECTOR : "mock" | "kasa" = process.env.LIGHT_CONNECTOR === "kasa" ? "kasa" : "mock";

// path to lights.json
const thisDir = dirname(fileURLToPath(import.meta.url)); // .../light-agent/src
const LIGHTS_FILE = join(thisDir, "..", "lights.json"); // .../light-agent/lights.json

// read saved lights from file or return empty array

export function loadLights(): DeviceInfo[] {
    if (!existsSync(LIGHTS_FILE)) return [];
    const raw = readFileSync(LIGHTS_FILE, "utf-8");
    return JSON.parse(raw) as DeviceInfo[];
}

// save lights to file

export function saveLights(lights: DeviceInfo[]): void {
    writeFileSync(LIGHTS_FILE, JSON.stringify(lights, null, 2), "utf-8");
}
