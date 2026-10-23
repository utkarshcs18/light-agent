/**
 * server.ts - Alexa+ contract.
 *
 * Streamable HTTP MCP server on protocol version 2025-11-25.
 * Tools map onto the connector and the scheduler that already live in this process.
 * Closing the browser does not stop a loop. A new session lists the same tasks.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { dispatchTool } from "../agent/lightAgent.js";
import { AWAY_MARK } from "../presence.js";
import { compileUtterance } from "../intent.js";
import type { TaskScheduler } from "../scheduler.js";
import type { DeviceInfo, LightConnector } from "../types.js";
import { buildBoard, lightLabel, type Board } from "./board.js";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface IntentionRunner {
  run(utterance: string): Promise<string>;
}

export interface LightServerOptions {
  connector: LightConnector;
  scheduler: TaskScheduler;
  lights: DeviceInfo[];
  agent: IntentionRunner | null;
  port?: number;
  host?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const actionSchema = z.object({
  type: z.enum(["setPower", "setBrightness", "setColor", "cycleColor"]),
  power: z.enum(["on", "off"]).optional(),
  brightness: z.number().optional(),
  hue: z.number().optional(),
  saturation: z.number().optional(),
});

export async function startLightServer(options: LightServerOptions): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const sessions = new Map<string, Session>();
  let closed = false;

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    try {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === "/mcp") {
        await handleMcp(req, res, options, sessions);
        return;
      }
      if (req.method === "GET") {
        serveStatic(req, res, url.pathname);
        return;
      }
      res.writeHead(405, { Allow: "GET" });
      res.end("Method not allowed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, host, () => resolve());
  });

  const address = http.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://${host}:${port}`,
    port,
    async close() {
      if (closed) return;
      closed = true;
      options.scheduler.halt();
      for (const session of sessions.values()) {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  options: LightServerOptions,
  sessions: Map<string, Session>
): Promise<void> {
  const body = req.method === "POST" ? await readBody(req) : undefined;
  const sessionHeader = header(req, "mcp-session-id");
  const existing = sessionHeader ? sessions.get(sessionHeader) : undefined;

  if (existing) {
    await existing.transport.handleRequest(req, res, body);
    return;
  }

  if (sessionHeader && !existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }

  const mcp = buildMcpServer(options);
  let remembered = false;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      remembered = true;
      sessions.set(sessionId, { transport, server: mcp });
      while (sessions.size > 8) {
        const oldest = sessions.keys().next().value;
        if (!oldest) break;
        const stale = sessions.get(oldest);
        sessions.delete(oldest);
        void stale?.transport.close();
        void stale?.server.close();
      }
    },
  });
  transport.onclose = () => {
    const id = transport.sessionId;
    if (id && sessions.get(id)?.transport === transport) sessions.delete(id);
  };

  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);

  res.on("close", () => {
    // A session that never finished initialize should not linger.
    if (!remembered) {
      void transport.close();
      void mcp.close();
    }
  });
}

function buildMcpServer(options: LightServerOptions): McpServer {
  const { connector, scheduler, lights, agent } = options;
  // Protocol version served by this process: 2025-11-25.
  const server = new McpServer(
    { name: "light-agent", version: "1.0.0" },
    {
      instructions:
        "Alexa+ lighting add-on. One spoken intention becomes a verified local loop. Later ticks do not call a model.",
    }
  );

  const run = async (name: string, args: Record<string, unknown>) => {
    const out = await dispatchTool(name, args, connector, scheduler);
    const speech = out.isError ? out.content : (out.speech ?? speechFor(name, args, scheduler, lights));
    const board = await buildBoard(connector, scheduler, speech);
    if (out.sky) board.sky = out.sky;
    return jsonResult(board, Boolean(out.isError));
  };

  server.registerTool(
    "list_lights",
    {
      description: "List known lights and the current card board.",
      inputSchema: {},
    },
    async () => run("list_lights", {})
  );

  server.registerTool(
    "get_state",
    {
      description: "Read one light. Returns the card board, including that light's HSV state.",
      inputSchema: { id: z.string() },
    },
    async (args) => run("get_state", args)
  );

  server.registerTool(
    "set_power",
    {
      description: "Turn one light, or several, on or off. Off also stops loops on those lights so a cycle cannot turn them back on.",
      inputSchema: {
        id: z.string().optional(),
        ids: z.array(z.string()).optional(),
        power: z.enum(["on", "off"]),
      },
    },
    async (args) => run("set_power", args)
  );

  server.registerTool(
    "set_brightness",
    {
      description: "Set brightness from 0 to 100 and turn the light on.",
      inputSchema: { id: z.string(), brightness: z.number() },
    },
    async (args) => run("set_brightness", args)
  );

  server.registerTool(
    "set_color",
    {
      description: "Set HSV hue (0-360) and saturation (0-100), and turn the light on.",
      inputSchema: { id: z.string(), hue: z.number(), saturation: z.number() },
    },
    async (args) => run("set_color", args)
  );

  server.registerTool(
    "schedule_recurring_task",
    {
      description:
        "Start a verified loop. Each later tick executes, reads the bulb, and retries with backoff. No model call per tick.",
      inputSchema: {
        lightId: z.string().optional(),
        lightIds: z.array(z.string()).optional(),
        description: z.string(),
        action: actionSchema,
        intervalSeconds: z.number().optional(),
        intervalMinutes: z.number().optional(),
      },
    },
    async (args) => run("schedule_recurring_task", args)
  );

  server.registerTool(
    "list_scheduled_tasks",
    {
      description: "List loops owned by this process, including ones started in another browser session.",
      inputSchema: {},
    },
    async () => run("list_scheduled_tasks", {})
  );

  server.registerTool(
    "cancel_scheduled_task",
    {
      description: "Cancel one loop, or several, by id.",
      inputSchema: { taskId: z.string().optional(), taskIds: z.array(z.string()).optional() },
    },
    async (args) => run("cancel_scheduled_task", args)
  );

  server.registerTool(
    "loop_status",
    {
      description:
        "Latest verify / retry events (apply, mismatch, retry, verified, failed) plus the light and loop cards.",
      inputSchema: { taskId: z.string().optional() },
    },
    async (args) => run("loop_status", args)
  );

  server.registerTool(
    "simulate_miss",
    {
      description:
        "Drop the next scheduled write for one light so the following tick shows mismatch, then retry, then verified.",
      inputSchema: { id: z.string() },
    },
    async (args) => run("simulate_miss", args)
  );

  server.registerTool(
    "match_weather",
    {
      description:
        "Color one light, or every light, from the current weather. Omit id to color every light. Optional place is a city name.",
      inputSchema: {
        id: z.string().optional(),
        place: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      },
    },
    async (args) => run("match_weather", args)
  );

  server.registerTool(
    "set_presence",
    {
      description:
        "Remember who is home. away saves every bulb and keeps the lights off. home restores that room and stops the watch.",
      inputSchema: { mode: z.enum(["home", "away"]) },
    },
    async (args) => run("set_presence", args)
  );

  server.registerTool(
    "compile_intention",
    {
      description:
        "Compile one spoken intention into a single tool call. Known lighting phrases do not call a model. The page then calls the returned tool over MCP.",
      inputSchema: { utterance: z.string() },
    },
    async (args) => {
      const compiled = compileUtterance(args.utterance, lights, scheduler.list());
      if (compiled?.kind === "call") {
        const board = await buildBoard(connector, scheduler, "");
        board.compiled = { tool: compiled.tool, arguments: compiled.args };
        board.alreadyDone = false;
        return jsonResult(board);
      }
      if (compiled?.kind === "clarify") {
        const board = await buildBoard(connector, scheduler, compiled.speech);
        board.alreadyDone = true;
        return jsonResult(board);
      }
      if (!agent) {
        const board = await buildBoard(
          connector,
          scheduler,
          "I can cycle a light, match the weather, change a color, drop the next write, or tell you which loops are running."
        );
        board.alreadyDone = true;
        return jsonResult(board);
      }
      try {
        const reply = await agent.run(args.utterance);
        const board = await buildBoard(connector, scheduler, reply);
        board.alreadyDone = true;
        return jsonResult(board);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const speech = /credit balance|invalid_request_error|anthropic/i.test(message)
          ? "The model has no credits, so I stayed local. Say run the living room loop, cycle the kitchen every five seconds, I'm leaving, or match the weather."
          : "I couldn't reach the model. Loops already running on this machine are still going.";
        const board = await buildBoard(connector, scheduler, speech);
        board.alreadyDone = true;
        return jsonResult(board);
      }
    }
  );

  return server;
}

function jsonResult(board: Board, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(board) }],
    isError,
  };
}

function speechFor(
  name: string,
  args: Record<string, unknown>,
  scheduler: TaskScheduler,
  lights: DeviceInfo[]
): string {
  const label = (id: string) => lightLabel(id, lights);
  switch (name) {
    case "schedule_recurring_task": {
      const ids = Array.isArray(args.lightIds)
        ? args.lightIds.map((item) => String(item))
        : [String(args.lightId ?? "")];
      const names = ids.map((id) => label(id)).filter(Boolean);
      const light = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "That light";
      const action = args.action as { type?: string } | undefined;
      if (action?.type === "cycleColor") {
        return names.length > 1
          ? `${light} are cycling together. I'll check each bulb every tick.`
          : `${light} is cycling. I'll check the bulb every tick.`;
      }
      return `${light} is on a loop. I'll check the bulb every tick.`;
    }
    case "set_presence":
      return "The room follows who is home.";
    case "simulate_miss":
      return `The next ${label(String(args.id ?? "light"))} write will drop. The loop will read the bulb and try again.`;
    case "list_scheduled_tasks": {
      const tasks = scheduler.list();
      const active = tasks.filter((task) => task.status === "active");
      const cycling = active.filter((task) => task.action.type === "cycleColor");
      const held = active.filter((task) => task.description === AWAY_MARK);
      if (cycling.length) {
        const names = [...new Set(cycling.map((task) => label(task.lightId)))];
        const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
        const verb = names.length > 1 ? "are" : "is";
        return `${who} ${verb} cycling. The color changes on each check.`;
      }
      if (held.length) {
        return "Nothing is cycling. You're away, so those checks only keep the lights off.";
      }
      if (active.length) {
        const names = [...new Set(active.map((task) => label(task.lightId)))];
        const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
        return `${who} ${names.length > 1 ? "are" : "is"} on a loop.`;
      }
      const failed = tasks.find((task) => task.status === "error");
      if (failed) return `${label(failed.lightId)} loop stopped. The bulb never matched.`;
      return "Nothing is looping right now.";
    }
    case "cancel_scheduled_task": {
      const count = Array.isArray(args.taskIds) ? args.taskIds.length : 1;
      return count > 1 ? "Those loops are cancelled." : "That loop is cancelled.";
    }
    case "set_power": {
      const ids = Array.isArray(args.ids)
        ? args.ids.map((item) => String(item))
        : [String(args.id ?? "")];
      const names = ids.map((id) => label(id)).filter(Boolean);
      const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "That light";
      const power = String(args.power ?? "");
      const verb = names.length > 1 ? "are" : "is";
      return power === "off" ? `${who} ${verb} off. I stopped their loops.` : `${who} ${verb} on.`;
    }
    case "set_brightness":
      return `${label(String(args.id ?? ""))} is at ${String(args.brightness ?? "")} percent.`;
    case "set_color":
      return `${label(String(args.id ?? ""))} color is set.`;
    default:
      return "";
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = header(req, "origin");
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(_req: IncomingMessage, res: ServerResponse, pathname: string): void {
  let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (rel === "web" || rel.startsWith("web/")) rel = rel.slice(4) || "index.html";
  if (rel.includes("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const file = normalize(join(WEB_ROOT, rel));
  const root = normalize(WEB_ROOT);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}
