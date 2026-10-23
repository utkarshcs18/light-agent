import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MockConnector } from "../connector/mockConnector.js";
import { startLightServer, type RunningServer } from "./server.js";
import { TaskScheduler } from "../scheduler.js";
import type { DeviceInfo } from "../types.js";

const lights: DeviceInfo[] = [
  { id: "living-room", alias: "Living room" },
  { id: "kitchen", alias: "Kitchen" },
  { id: "desk", alias: "Desk" },
];

describe("MCP streamable HTTP", () => {
  let server: RunningServer;
  let scheduler: TaskScheduler;

  after(async () => {
    await server?.close();
  });

  it("schedules over tools/call, survives a new session, and shows a miss", async () => {
    const connector = new MockConnector(lights);
    await connector.setPower("kitchen", "on");
    await connector.setColor("kitchen", 200, 78);
    scheduler = new TaskScheduler(connector);
    server = await startLightServer({
      connector,
      scheduler,
      lights,
      agent: null,
      port: 0,
    });

    const session = await openSession(server.url);
    const listed = await rpc(server.url, session, "tools/list", {});
    const names = (listed.tools as { name: string }[]).map((tool) => tool.name);
    assert.ok(names.includes("schedule_recurring_task"));
    assert.ok(names.includes("loop_status"));
    assert.ok(names.includes("simulate_miss"));

    const compiled = await tool(server.url, session, "compile_intention", {
      utterance: "Alexa, cycle the kitchen color every five seconds.",
    });
    assert.equal(compiled.compiled.tool, "schedule_recurring_task");

    const board = await tool(server.url, session, compiled.compiled.tool, compiled.compiled.arguments);
    assert.match(board.speech, /Kitchen is cycling/);
    assert.equal(board.tasks.length, 1);
    assert.equal(board.tasks[0].status, "active");
    assert.equal(board.tasks[0].runCount, 1);
    const kitchen = board.lights.find((light: { id: string }) => light.id === "kitchen");
    assert.equal(kitchen.state.hue, 45);
    assert.ok(board.events.some((event: { phase: string }) => event.phase === "verified"));

    const next = await openSession(server.url);
    const again = await tool(next.url, next, "list_scheduled_tasks", {});
    assert.equal(again.tasks.length, 1);
    assert.equal(again.tasks[0].lightId, "kitchen");
    assert.match(again.speech, /cycling/);

    await tool(server.url, session, "simulate_miss", { id: "kitchen" });
    await scheduler.runTick(board.tasks[0].id);
    const traced = await tool(server.url, next, "loop_status", {});
    const phases = traced.events.map((event: { phase: string }) => event.phase);
    assert.ok(phases.includes("mismatch"));
    assert.ok(phases.includes("retry"));
    assert.equal(traced.tasks[0].status, "active");
  });
});

interface Session {
  url: string;
  id: string | null;
}

async function openSession(url: string): Promise<Session> {
  const session: Session = { url, id: null };
  const init = await rpc(url, session, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "light-agent-test", version: "1.0.0" },
  });
  assert.equal(init.protocolVersion, "2025-11-25");
  await notify(url, session, "notifications/initialized");
  return session;
}

async function tool(url: string, session: Session, name: string, args: Record<string, unknown>) {
  const result = await rpc(url, session, "tools/call", { name, arguments: args });
  const text = (result.content as { text: string }[]).map((block) => block.text).join("");
  return JSON.parse(text);
}

async function rpc(url: string, session: Session, method: string, params: unknown) {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) session.id = sid;
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } };
  assert.equal(res.ok, true, JSON.stringify(body));
  assert.equal(body.error, undefined, body.error?.message);
  return body.result ?? {};
}

async function notify(url: string, session: Session, method: string) {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ jsonrpc: "2.0", method }),
  });
  assert.ok(res.status < 400, `notify ${method} -> ${res.status}`);
  await res.text();
}

function headers(session: Session): Record<string, string> {
  const value: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  };
  if (session.id) value["Mcp-Session-Id"] = session.id;
  return value;
}
