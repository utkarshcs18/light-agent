# Light Agent

**Tell Alexa+ once. A local loop proves the bulb obeyed.**

Light Agent is an Alexa+ lighting add-on for TP-Link Kasa bulbs. You speak a plain-English intention. Alexa+ calls a self-hosted MCP server, which compiles that sentence into a structured action. After that, a scheduler on your machine runs the action, reads the bulb back, and retries until the light matches. Later ticks never call the model. A new session can still list or cancel the loop.

> “Alexa, cycle the kitchen color every five seconds.”
> “Alexa, what loops are running?”

The sentence is how a loop gets created. The product is the loop Alexa+ can see, hear, and remember.

## Why this is the Alexa+ shape

Built for the Alexa+ track of [Build, Ship, Shape](https://amazonappdev2026.devpost.com/): a self-hosted MCP server (spec 2025-11-25+, Streamable HTTP) and an Alexa+ web experience that is a real MCP client. Alexa+ device onboarding is partner-gated, so the page is the environment judges can use: voice in, a spoken confirmation, and cards for bulb color, loop status, and each verify or retry.

- **It keeps working after the reply.** Scheduling is one tool call. Every later tick is execute, then `getState`, then retry, inside the server.
- **It remembers across sessions.** Loops live in the MCP process and in `tasks.json`. Refresh the page, or start the process again, and the kitchen loop is still there.
- **The bulb is checked.** A miss retries with backoff, up to three times, before the task is marked failed. The card trace shows `mismatch`, `retry`, and `verified`.
- **Control stays on the LAN.** Bulbs are driven locally. Discovery and naming happen once; `lights.json` is the registry.
- **Hardware is a plug.** The agent and the scheduler know only `LightConnector`. `MockConnector` runs the full loop with no bulbs. `KasaConnector` talks to real KL/LB bulbs.

## What a request becomes

Immediate actions: power, brightness, color.

Recurring actions: the same, on an interval, plus `cycleColor`, which steps hue on every tick.

Weather: “Match the lights to the weather” reads the sky where you are and sets the bulb color. A named room colors just that light. A city works too: “Match the kitchen to the weather in Paris.”

Presence: “I’m leaving” saves the room and keeps the lights off, even if one is turned back on. “I’m back” restores that room. The saved room stays in `presence.json` across a restart.

Spoken into the Alexa+ page, each of those is an MCP `tools/call`. The page does not touch the bulbs itself.

## Run

From this folder:

```bash
npm run setup     # discover bulbs on the LAN, name them, write lights.json
npm run agent     # MCP server + Alexa+ page; leave this open so ticks can fire
npm run typecheck
```

`ANTHROPIC_API_KEY` belongs in `.env`. `LIGHT_CONNECTOR=mock` runs with no hardware. `LIGHT_CONNECTOR=kasa` drives real bulbs.

Open the Alexa+ page at [http://127.0.0.1:8787](http://127.0.0.1:8787), allow the microphone, and speak. A text field is there when the mic is unavailable. The terminal REPL is a developer console. Loops keep running if you refresh the page. Stopping the process writes them to `tasks.json` and the next `npm run agent` resumes them.

```bash
npm test          # scheduler miss/retry, spoken compile, task restore, MCP session
```

## Devpost

Light Agent is the closed loop Alexa routines do not have. One spoken intention becomes a recurring policy. Later ticks run, verify, and retry on the LAN with no model call. A new Alexa+ session, and a restarted process, can still list that policy. Cards show the live bulb color and the verify trace.

Run `npm run agent` in this folder and open `http://127.0.0.1:8787`. The page is the Alexa+ stand-in because device onboarding is partner-gated. It is a real MCP client (`initialize`, `tools/list`, `tools/call`) against a self-hosted Streamable HTTP server on spec 2025-11-25.

Friction: the Alexa+ console, Category SDK, and device onboarding are partner-gated, so this submission uses the FAQ path — Streamable HTTP plus a web MCP client — instead of a 2018 custom skill.

## License

[MIT](LICENSE). That permission includes using this project as a voice assistant. The Alexa+ page in `web/` may listen, speak, and call the MCP server, and anyone may ship that assistant.
