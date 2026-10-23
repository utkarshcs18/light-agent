/**
 * index.ts - `npm run agent` entry.
 *
 * Starts the MCP server and the Alexa+ page, then a developer REPL when stdin is a terminal.
 * Loops live in this process. Closing the browser does not cancel them.
 */

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from "@anthropic-ai/sdk";

import { dispatchTool, LightAgent } from "./agent/lightAgent.js";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, CONNECTOR, PORT, loadLights } from "./config.js";
import { MockConnector } from "./connector/mockConnector.js";
import { KasaConnector } from "./connector/kasaConnector.js";
import { compileUtterance } from "./intent.js";
import { startLightServer } from "./mcp/server.js";
import { TaskScheduler } from "./scheduler.js";
import { loadStoredTasks, saveStoredTasks } from "./taskStore.js";
import type { DeviceInfo, LightConnector, LoopEvent } from "./types.js";

const SEED_LIGHTS: DeviceInfo[] = [
  { id: "living-room", alias: "Living room" },
  { id: "kitchen", alias: "Kitchen" },
  { id: "desk", alias: "Desk" },
];

async function main(): Promise<void> {
  const saved = loadLights();
  const seeded = saved.length === 0 && CONNECTOR !== "kasa";
  const lights = seeded ? SEED_LIGHTS : saved;

  if (!seeded && lights.length === 0) {
    console.log("No lights in lights.json. Run `npm run setup`, or use LIGHT_CONNECTOR=mock.");
  }

  const connector: LightConnector =
    CONNECTOR === "kasa" ? new KasaConnector(lights) : new MockConnector(lights);

  if (seeded) {
    await paintSeed(connector);
  }

  let repl: readline.Interface | undefined;
  const scheduler = new TaskScheduler(
    connector,
    (event) => {
      const line = formatEvent(event);
      if (repl) {
        output.write("\n" + line + "\n");
        repl.prompt();
      } else {
        console.log(line);
      }
    },
    saveStoredTasks
  );
  const restored = loadStoredTasks();
  scheduler.restore(restored);

  const agent = ANTHROPIC_API_KEY
    ? new LightAgent(new Anthropic({ apiKey: ANTHROPIC_API_KEY }), connector, scheduler, CLAUDE_MODEL, lights)
    : null;

  const server = await startLightServer({
    connector,
    scheduler,
    lights,
    agent,
    port: PORT,
  });

  console.log("");
  console.log("Light Agent");
  console.log(`Alexa+ page   ${server.url}`);
  console.log(`Connector     ${CONNECTOR}`);
  console.log(`Lights        ${lights.map((light) => light.id).join(", ") || "(none)"}`);
  console.log("Loops stay in this process after the browser closes.");
  console.log("They are written to tasks.json and resume on the next start.");
  const active = restored.filter((task) => task.status === "active").length;
  if (active > 0) console.log(`Restored ${active} loop${active === 1 ? "" : "s"}.`);
  if (!agent) {
    console.log("No ANTHROPIC_API_KEY. Spoken demo phrases still compile locally.");
  }
  console.log("");

  const shutdown = async () => {
    await server.close();
  };

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  if (!input.isTTY) return;

  repl = readline.createInterface({ input, output, prompt: "lights> " });
  console.log("REPL is the developer console. Type exit to stop the process.\n");
  repl.prompt();

  repl.on("line", (line) => {
    void handleLine(line, { connector, scheduler, lights, agent, repl: repl! });
  });

  repl.on("close", () => {
    void shutdown().then(() => {
      console.log("\nBye. Loops are saved in tasks.json.");
      process.exit(0);
    });
  });
}

async function paintSeed(connector: LightConnector): Promise<void> {
  await connector.setPower("living-room", "on");
  await connector.setBrightness("living-room", 72);
  await connector.setColor("living-room", 28, 48);

  await connector.setPower("kitchen", "on");
  await connector.setBrightness("kitchen", 80);
  await connector.setColor("kitchen", 200, 78);

  await connector.setPower("desk", "on");
  await connector.setBrightness("desk", 58);
  await connector.setColor("desk", 214, 35);
}

function formatEvent(event: LoopEvent): string {
  const detail = event.detail ? ` ${event.detail}` : "";
  return `[loop] ${event.lightId} ${event.phase} attempt ${event.attempt}${detail}`;
}

async function handleLine(
  line: string,
  ctx: {
    connector: LightConnector;
    scheduler: TaskScheduler;
    lights: DeviceInfo[];
    agent: LightAgent | null;
    repl: readline.Interface;
  }
): Promise<void> {
  const text = line.trim();
  if (text === "") {
    ctx.repl.prompt();
    return;
  }
  if (text === "exit" || text === "quit") {
    ctx.repl.close();
    return;
  }

  try {
    const compiled = compileUtterance(text, ctx.lights, ctx.scheduler.list());
    if (compiled?.kind === "call") {
      const out = await dispatchTool(compiled.tool, compiled.args, ctx.connector, ctx.scheduler);
      output.write(out.content + "\n");
    } else if (compiled?.kind === "clarify") {
      output.write(compiled.speech + "\n");
    } else if (ctx.agent) {
      output.write((await ctx.agent.run(text)) + "\n");
    } else {
      output.write("Set ANTHROPIC_API_KEY for open-ended requests. Try cycling a light, or ask what is running.\n");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`Error: ${msg}\n`);
  }
  ctx.repl.prompt();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
