/**
 * index.ts - `npm run agent` entry point: a persistent interactive REPL.
 *
 * TODO:
 *   - lights = loadLights(); if empty, tell the user to run `npm run setup`.
 *   - connector = CONNECTOR === "kasa" ? new KasaConnector(lights) : new MockConnector(lights)
 *   - rl = readline.createInterface({ input, output, prompt: "lights> " })
 *   - scheduler = new TaskScheduler(connector, (msg) => { console.log("\n" + msg); rl.prompt(); })
 *   - agent = new LightAgent(new Anthropic({ apiKey: ANTHROPIC_API_KEY }), connector, scheduler, CLAUDE_MODEL, lights)
 *   - rl.on("line"): "exit" -> scheduler.cancelAll() + rl.close(); else print await agent.run(line); rl.prompt()
 *
 * The open readline + setInterval timers keep the process alive so scheduled tasks keep firing.
 */
