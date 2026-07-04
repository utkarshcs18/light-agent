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
