# Light Agent - Progress Tracker

> Living log of what is done, in progress, and pushed. Update this whenever you finish a chunk of
> work or push to git. For the design details see `PLAN.md`.

## Legend
- `[x]` done  -  `[~]` in progress  -  `[ ]` not started

## Current status
Scaffolding and dependencies are complete. `src/types.ts` and `src/config.ts` are done. Next up:
`src/connector/mockConnector.ts` (the first `LightConnector` implementation).

## Build checklist (in build order)
- [x] Project scaffolding - `package.json` (type: module, scripts), `tsconfig.json`, `.gitignore`, `.env` / `.env.example`
- [x] Dependencies installed - `@anthropic-ai/sdk`, `tplink-smarthome-api`; dev: `typescript`, `tsx`, `@types/node@24`
- [x] `CLAUDE.md` - agent guidance
- [x] `PLAN.md` + `PROGRESS.md` - documentation
- [x] Source skeleton - all `src/**/*.ts` created with TODO headers
- [x] `src/types.ts` - `Power`, `LightState`, `DeviceInfo`, `LightConnector`, `TaskAction`, `TaskStatus`, `ScheduledTask`
- [x] `src/config.ts` - env + `loadLights()` / `saveLights()`
- [ ] `src/connector/mockConnector.ts` - in-memory connector
- [ ] `src/scheduler.ts` - TaskScheduler loop engine
- [ ] `src/agent/tools.ts` - Anthropic tool schemas
- [ ] `src/agent/systemPrompt.ts` - `buildSystemPrompt()`
- [ ] `src/agent/lightAgent.ts` - tool-use loop + `dispatchTool()`
- [ ] `src/index.ts` - persistent REPL
- [ ] End-to-end test with `MockConnector`
- [ ] `src/connector/kasaConnector.ts` - real bulbs
- [ ] `src/setup.ts` - discovery + naming + persist
- [ ] Test with real Kasa bulbs on the LAN

## Open decisions / notes
- `DeviceInfo.host` is currently optional (`host?`). `KasaConnector` needs a host to reach a bulb, so
  it must be present for real hardware - either enforce it there or make `host` required later.
- Each `TaskAction` variant carries its own `id`, which duplicates `ScheduledTask.lightId`. Pick one
  source of truth when writing the scheduler (either is fine).
- `ScheduledTask.lastRun` is a `Date` (not an ISO string). Fine in memory; convert if we ever persist
  tasks to JSON.

## Changelog
Newest first. Note what changed and, once pushed, the commit.

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
