/**
 * board.ts - the card payload every MCP tool returns to the Alexa+ page.
 */

import type { DeviceInfo, LightConnector, LoopEvent, TaskStatus } from "../types.js";
import { loadPresence } from "../presence.js";
import type { TaskScheduler } from "../scheduler.js";

export interface BoardLight {
  id: string;
  alias?: string;
  state: {
    power: "on" | "off";
    brightness?: number;
    hue?: number;
    saturation?: number;
  };
}

export interface BoardTask {
  id: string;
  lightId: string;
  description: string;
  intervalMs: number;
  status: TaskStatus;
  runCount: number;
  lastError?: string;
  actionType: string;
}

export interface Board {
  speech: string;
  lights: BoardLight[];
  tasks: BoardTask[];
  events: LoopEvent[];
  /** Set when compile_intention wants the page to make this tools/call next. */
  compiled?: { tool: string; arguments: Record<string, unknown> } | null;
  /** The utterance was fully handled. The page should not issue a follow-up call. */
  alreadyDone?: boolean;
  proof: BoardProof;
  presence: BoardPresence;
  sky?: BoardSky;
}

export interface BoardSky {
  place: string;
  summary: string;
  swatch: string;
  hue: number;
  source: "browser" | "network" | "city" | "timezone";
}

export interface BoardPresence {
  mode: "home" | "away";
  since?: string;
  savedLights: number;
}

export interface BoardProof {
  customer: string;
  ticks: number;
  modelCalls: 0;
  verifiedRuns: number;
  activeLoops: number;
  maxAttempts: 3;
  backoffMs: [200, 400];
}

export async function buildBoard(
  connector: LightConnector,
  scheduler: TaskScheduler,
  speech: string
): Promise<Board> {
  const lights = await connector.listLights();
  const withState: BoardLight[] = [];
  for (const light of lights) {
    withState.push({
      id: light.id,
      alias: light.alias,
      state: await connector.getState(light.id),
    });
  }

  const tasks = scheduler.list();
  const presence = loadPresence();
  return {
    speech,
    lights: withState,
    proof: {
      customer: "Homes whose Alexa routine never checks the bulb.",
      ticks: scheduler.tickCount(),
      modelCalls: 0,
      verifiedRuns: tasks.reduce((sum, task) => sum + task.runCount, 0),
      activeLoops: tasks.filter((task) => task.status === "active" && task.action.type === "cycleColor").length,
      maxAttempts: 3,
      backoffMs: [200, 400],
    },
    presence: {
      mode: presence.mode,
      since: presence.since,
      savedLights: presence.scene.length,
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      lightId: task.lightId,
      description: task.description,
      intervalMs: task.intervalMs,
      status: task.status,
      runCount: task.runCount,
      lastError: task.lastError,
      actionType: task.action.type,
    })),
    events: scheduler.recentEvents(),
  };
}

export function lightLabel(id: string, lights: DeviceInfo[]): string {
  const found = lights.find((light) => light.id === id);
  if (found?.alias) return found.alias;
  return id
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
