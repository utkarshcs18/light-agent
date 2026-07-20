# Light Agent - Progress Tracker

> Living log of what is done, in progress, and pushed. Update this whenever you finish a chunk of
> work or push to git. For the design details see `PLAN.md`.

## Legend
- `[x]` done  -  `[~]` in progress  -  `[ ]` not started

## Current status
Feature-complete. All `src/**/*.ts` are implemented and the project typechecks cleanly. The
mock end-to-end path (connector -> tools bridge -> scheduler verify/retry loop) is verified;
the Kasa path is implemented but not yet tested against real hardware. Live agent runs need an
`ANTHROPIC_API_KEY` in `.env`.

## Build checklist (in build order)
- [x] Project scaffolding - `package.json` (type: module, scripts), `tsconfig.json`, `.gitignore`, `.env` / `.env.example`
- [x] Dependencies installed - `@anthropic-ai/sdk`, `tplink-smarthome-api`; dev: `typescript`, `tsx`, `@types/node@24`
- [x] `CLAUDE.md` - agent guidance
- [x] `PLAN.md` + `PROGRESS.md` - documentation
- [x] Source skeleton - all `src/**/*.ts` created with TODO headers
- [x] `src/types.ts` - `Power`, `LightState`, `DeviceInfo`, `LightConnector`, `TaskAction`, `TaskStatus`, `ScheduledTask`
- [x] `src/config.ts` - env + `loadLights()` / `saveLights()`
- [x] `src/connector/mockConnector.ts` - in-memory connector
- [x] `src/scheduler.ts` - TaskScheduler loop engine (apply -> verify -> retry w/ backoff)
- [x] `src/agent/tools.ts` - Anthropic tool schemas (light + schedule_* tools)
- [x] `src/agent/systemPrompt.ts` - `buildSystemPrompt()`
- [x] `src/agent/lightAgent.ts` - tool-use loop + `dispatchTool()`
- [x] `src/index.ts` - persistent REPL
- [x] End-to-end test with `MockConnector` (tools bridge + scheduler verify/retry)
- [x] `src/connector/kasaConnector.ts` - real bulbs
- [x] `src/setup.ts` - discovery + naming + persist
- [ ] Test with real Kasa bulbs on the LAN (needs hardware)

## Open decisions / notes
- `DeviceInfo.host` is currently optional (`host?`). `KasaConnector` needs a host to reach a bulb, so
  it must be present for real hardware - either enforce it there or make `host` required later.
- Each `TaskAction` variant carries its own `id`, which duplicates `ScheduledTask.lightId`. Pick one
  source of truth when writing the scheduler (either is fine).
- `ScheduledTask.lastRun` is a `Date` (not an ISO string). Fine in memory; convert if we ever persist
  tasks to JSON.

## Changelog
Newest first. Note what changed and, once pushed, the commit.

### 2026-07-20
- Completed the end-to-end build. Implemented the seven remaining files:
  - `scheduler.ts`: `TaskScheduler` with `schedule/list/cancel/cancelAll`; each tick maps a
    `TaskAction` to connector calls, verifies via `getState`, and retries up to 3x with
    exponential backoff (200/400ms) before marking a task `error`. `cycleColor` advances a
    per-task hue counter (+45 deg) each tick.
  - `agent/tools.ts`: five light tools + three scheduling tools as `Anthropic.Tool[]`.
  - `agent/systemPrompt.ts`: `buildSystemPrompt(lights)` listing ids, tools, HSV color hints,
    and the allowed `TaskAction` shapes.
  - `agent/lightAgent.ts`: `LightAgent.run()` tool-use loop (max 10 turns) + `dispatchTool()`
    routing light tools to the connector and schedule tools to the scheduler; tool errors come
    back as `is_error` results so Claude can recover.
  - `index.ts`: readline REPL, connector selection, scheduler event printing, clean `exit`.
  - `connector/kasaConnector.ts`: `LightConnector` over `tplink-smarthome-api` (id -> host,
    cached `Bulb` handles, HSV via `lighting.setLightState`).
  - `setup.ts`: 5s LAN discovery, per-bulb id prompt, writes `lights.json`.
- Fixed the `CLAUDE_MODEL` default in `config.ts` (`claude-opus-4-1776` -> `claude-sonnet-4-5`,
  matching PLAN §6.2; the old value was not a valid model id).
- Interop fix: `tplink-smarthome-api` is CommonJS with getter-based named exports that Node's
  ESM loader doesn't surface, so `import { Client }` failed at runtime. Switched `kasaConnector.ts`
  and `setup.ts` to a default import + destructure.
- Verified: `npm run typecheck` clean; a mock end-to-end harness exercised all light tools,
  `cycleColor` hue advancement + verification, and the retry-to-`error` path on a mismatching
  connector; REPL boots and exits cleanly and guards a missing API key.

### 2026-07-06
- Implemented `src/connector/mockConnector.ts`: `MockConnector implements LightConnector`, backed by an in-memory `Map<string, LightState>` seeded from the device registry (logs actions; unknown id throws).

### 2026-07-04
- Pinned TypeScript to 5.9.3 (was 6.0.3) so CLI `tsc` resolves `@types/node`; aligns typecheck with the editor and the root project.
- Implemented `src/config.ts`: `.env` loading via `process.loadEnvFile()`, `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` / `CONNECTOR` exports, and `loadLights()` / `saveLights()` for `lights.json` (fixed a missing `join` import).
- Completed `src/types.ts`: added `LightConnector`, `TaskAction`, `TaskStatus`, `ScheduledTask`.
- Implemented `Power`, `LightState`, `DeviceInfo` in `src/types.ts`.
- Added `PLAN.md` (full design) and `PROGRESS.md` (this tracker).
- Fixed a JSDoc bug in `src/agent/lightAgent.ts`: a stray `*/` inside a comment closed it early and
  produced a TS2363 arithmetic error. Verified with `tsc --noEmit`.
- Created the `src/` skeleton (types, config, setup, index, scheduler, connector/*, agent/*) with
  guidance headers.
- Added `CLAUDE.md`.
- Scaffolded `light-agent` as a standalone project and installed dependencies.

## Pushed changes
Track git pushes here so contributors can map docs to commits.

| Date | Commit | Branch | Summary |
|------|--------|--------|---------|
| 2026-07-04 | a673f49 | main | Initial commit: full project scaffolding + `src/` |
| 2026-07-04 | 252ad63 | main | Add README.md |
| 2026-07-04 | a1f16e9 | main | Add config module + complete type contracts |
