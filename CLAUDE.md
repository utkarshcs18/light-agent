# CLAUDE.md

Guidance for AI agents (and humans) working in the `light-agent` project.

## Docs
- `PLAN.md` - full design reference: architecture, every file, and key decisions. Keep it updated.
- `PROGRESS.md` - what is done / in progress / pushed. Update it after each chunk of work.

## What this is
A CLI TypeScript app: an AI agent that controls TP-Link Kasa WiFi bulbs from natural
language. Claude interprets commands and calls tools; a swappable connector talks to the
bulbs; a scheduler runs recurring async tasks (e.g. "cycle the living room color every 5
minutes") with an execute -> verify -> retry loop.

## Commands
Always run from inside this folder (`light-agent/`), not the repo root. This is a
self-contained project with its own `package.json` and `node_modules`; running npm from
the parent `grind` folder will pollute that project.

- `npm run setup` - discover Kasa bulbs on the LAN, name them, save to `lights.json`
- `npm run agent` - start the interactive REPL (must stay open for scheduled tasks to fire)
- `npm run typecheck` - `tsc --noEmit`

`tsx` runs the TypeScript directly; there is no build step. `typescript` is only for `typecheck`.

## Architecture
Four responsibilities, kept deliberately separate:

- Connector (`src/connector/*`) = hands. Implements the `LightConnector` interface.
  `MockConnector` (no hardware) and `KasaConnector` (real bulbs).
- Agent (`src/agent/*`) = brain. Claude picks tools from natural language via a
  `messages.create` tool-use loop.
- Scheduler (`src/scheduler.ts`) = loop engine. Owns recurring tasks; each tick executes a
  structured action, verifies via `getState`, and retries with backoff.
- Tools (`src/agent/tools.ts`) = the bridge. What the brain may ask the hands / scheduler to do.

Data flow: user -> REPL (`index.ts`) -> `LightAgent.run()` -> Claude -> `dispatchTool()` ->
connector or scheduler.

## Layout
```
src/
  types.ts               contracts: Power, LightState, DeviceInfo, LightConnector, ScheduledTask, TaskAction
  config.ts              env (process.loadEnvFile) + loadLights()/saveLights() (lights.json)
  setup.ts               `npm run setup` entry: discovery + naming + persist
  scheduler.ts           TaskScheduler loop engine
  index.ts               `npm run agent` entry: persistent readline REPL, owns the scheduler
  connector/
    mockConnector.ts     in-memory LightConnector (build/test without hardware)
    kasaConnector.ts     real bulbs via tplink-smarthome-api
  agent/
    tools.ts             Anthropic tool schemas (light + schedule_* tools)
    systemPrompt.ts      buildSystemPrompt(lights)
    lightAgent.ts        the tool-use loop + dispatchTool()
```

## Conventions
- ESM + NodeNext: use explicit `.js` extensions on relative imports
  (e.g. `import { LightConnector } from "./types.js"`).
- The `LightConnector` interface is the contract. Add new hardware (Hue, LIFX) by
  implementing it; do not special-case hardware inside the agent.
- Scheduler ticks run structured actions only - no LLM call per tick (fast, deterministic,
  no token cost). Claude is used once, at schedule time, to translate the request into a task.
- Config comes from `.env`: `ANTHROPIC_API_KEY` (required), plus optional `CLAUDE_MODEL`
  and `LIGHT_CONNECTOR` (`mock` | `kasa`).
- Never commit `.env` or `lights.json` (both are gitignored).

## Kasa notes (tplink-smarthome-api v5)
- The library controls bulbs already on your WiFi; initial WiFi onboarding is done once in
  the Kasa mobile app.
- Supports Kasa KL/LB bulbs, NOT Tapo.
- `client.getDevice({ host })` returns `Bulb | Plug`; narrow/cast to `Bulb` before using
  `.lighting.setLightState(...)`.
- Discovery: `client.startDiscovery({ deviceTypes: ["bulb"], discoveryTimeout })` emits
  `device-new` with each bulb (`.alias`, `.host`, `.model`, `.mac`).

## Status
Scaffolding and dependencies are set up. The `src/` files listed above are written by the
project owner - follow this design and the interfaces defined in `types.ts`.
