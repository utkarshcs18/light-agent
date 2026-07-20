/**
 * index.ts - `npm run agent` entry point: a persistent interactive REPL.
 *
 * Loads the light registry, picks a connector, wires up a scheduler + agent, and reads lines
 * from the user. The open readline + any setInterval timers keep the process alive so scheduled
 * tasks keep firing in the background. Type `exit` (or Ctrl-D) to quit.
 */

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from "@anthropic-ai/sdk";

import { ANTHROPIC_API_KEY, CLAUDE_MODEL, CONNECTOR, loadLights } from "./config.js";
import { MockConnector } from "./connector/mockConnector.js";
import { KasaConnector } from "./connector/kasaConnector.js";
import { TaskScheduler } from "./scheduler.js";
import { LightAgent } from "./agent/lightAgent.js";
import type { LightConnector } from "./types.js";

async function main(): Promise<void> {
  if (!ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and set your key.");
    process.exit(1);
  }

  const lights = loadLights();
  if (lights.length === 0) {
    console.log(
      "No lights configured yet. Run `npm run setup` to discover and name your Kasa bulbs.\n" +
        "(You can still try the agent with LIGHT_CONNECTOR=mock, but there are no lights to control.)"
    );
  }

  const connector: LightConnector =
    CONNECTOR === "kasa" ? new KasaConnector(lights) : new MockConnector(lights);
  console.log(`Light Agent ready - connector: ${CONNECTOR}, model: ${CLAUDE_MODEL}`);
  console.log(`Lights: ${lights.map((l) => l.id).join(", ") || "(none)"}`);
  console.log("Type a command in plain English, or `exit` to quit.\n");

  const rl = readline.createInterface({ input, output, prompt: "lights> " });

  // Scheduler events (task ok/failed) print above the prompt, then re-render it.
  const scheduler = new TaskScheduler(connector, (msg) => {
    output.write("\n" + msg + "\n");
    rl.prompt();
  });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const agent = new LightAgent(client, connector, scheduler, CLAUDE_MODEL, lights);

  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (text === "") {
      rl.prompt();
      return;
    }
    if (text === "exit" || text === "quit") {
      rl.close();
      return;
    }

    try {
      const reply = await agent.run(text);
      output.write(reply + "\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`Error: ${msg}\n`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    scheduler.cancelAll();
    console.log("\nBye - all scheduled tasks cancelled.");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
