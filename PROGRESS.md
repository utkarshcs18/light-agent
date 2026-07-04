# Light Agent - Progress Tracker

> Living log of what is done, in progress, and pushed. Update this whenever you finish a chunk of
> work or push to git. For the design details see `PLAN.md`.

## Legend
- `[x]` done  -  `[~]` in progress  -  `[ ]` not started

## Current status
Scaffolding and dependencies are complete. Now implementing the core source files in build order.
Currently working on `src/types.ts`.

## Build checklist (in build order)
- [x] Project scaffolding - `package.json` (type: module, scripts), `tsconfig.json`, `.gitignore`, `.env` / `.env.example`
- [x] Dependencies installed - `@anthropic-ai/sdk`, `tplink-smarthome-api`; dev: `typescript`, `tsx`, `@types/node@24`
- [x] `CLAUDE.md` - agent guidance
- [x] `PLAN.md` + `PROGRESS.md` - documentation
- [x] Source skeleton - all `src/**/*.ts` created with TODO headers
- [~] `src/types.ts` - `Power`, `LightState`, `DeviceInfo` done; `LightConnector`, `TaskAction`, `TaskStatus`, `ScheduledTask` remaining
- [ ] `src/config.ts` - env + `loadLights()` / `saveLights()`
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
- Default `CLAUDE_MODEL` not yet pinned in `config.ts`.

## Changelog
Newest first. Note what changed and, once pushed, the commit.

### 2026-07-04
- Implemented `Power`, `LightState`, `DeviceInfo` in `src/types.ts`. (in progress)
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
| -    | -      | -      | Nothing pushed yet |
