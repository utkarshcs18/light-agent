/**
 * One-shot compiler. A sentence becomes tool calls. Ticks never enter this loop.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { DeviceInfo, LightConnector, Power, TaskAction } from "../types.js";
import type { TaskScheduler } from "../scheduler.js";
import { tools } from "./tools.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { currentWeather } from "../weather.js";
import { AWAY_EVERY_MS, AWAY_MARK, loadPresence, savePresence, type PresenceSceneLight } from "../presence.js";

const MAX_TOKENS = 1024;
// Safety valve so a misbehaving loop can't spin forever.
const MAX_TURNS = 10;

export class LightAgent {
  constructor(
    private client: Anthropic,
    private connector: LightConnector,
    private scheduler: TaskScheduler,
    private model: string,
    private lights: DeviceInfo[]
  ) {}

  async run(userInput: string): Promise<string> {
    const system = buildSystemPrompt(this.lights);
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userInput },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
      });

      // Record Claude's turn verbatim so tool_use ids line up with our tool_results.
      messages.push({ role: "assistant", content: res.content });

      if (res.stop_reason !== "tool_use") {
        return textOf(res.content);
      }

      // Execute every tool_use block in this turn and collect the results.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        const out = await dispatchTool(
          block.name,
          block.input as Record<string, unknown>,
          this.connector,
          this.scheduler
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: out.content,
          is_error: out.isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    return "Sorry, I couldn't complete that in a reasonable number of steps.";
  }
}

/** Join the text blocks of an assistant message into a single string. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

interface ToolOutput {
  content: string;
  isError?: boolean;
  /** Spoken line when it depends on the tool result, such as the live sky. */
  speech?: string;
  sky?: {
    place: string;
    summary: string;
    swatch: string;
    hue: number;
    source: "browser" | "network" | "city" | "timezone";
  };
}

/**
 * Route a tool call to the connector (light tools) or the scheduler (task tools) and return a
 * short text result. Errors are caught and returned as is_error tool results so Claude can react.
 */
export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  connector: LightConnector,
  scheduler: TaskScheduler
): Promise<ToolOutput> {
  try {
    switch (name) {
      case "list_lights": {
        const lights = await connector.listLights();
        return {
          content: lights.length
            ? lights.map((l) => `${l.id}${l.alias ? ` (${l.alias})` : ""}`).join(", ")
            : "No lights configured. Run `npm run setup`.",
        };
      }

      case "get_state": {
        const state = await connector.getState(String(input.id));
        return { content: JSON.stringify(state) };
      }

      case "set_power": {
        const power = input.power as Power;
        const ids = Array.isArray(input.ids) && input.ids.length
          ? input.ids.map((item) => String(item))
          : [String(input.id ?? "")].filter((item) => item && item !== "undefined");
        if (!ids.length) return { content: "Which light?", isError: true };
        if (power === "on") await comeHome(scheduler);
        for (const id of ids) {
          for (const task of scheduler.list()) {
            if (task.lightId !== id || task.status !== "active") continue;
            const forcesOff = task.action.type === "setPower" && task.action.power === "off";
            if (power === "off" || forcesOff) scheduler.cancel(task.id);
          }
        }
        await scheduler.idle();
        for (const id of ids) {
          await connector.setPower(id, power);
          if (power !== "on") continue;
          const state = await connector.getState(id);
          const dim = (state.brightness ?? 0) < 35;
          const uncolored = (state.saturation ?? 0) < 8;
          if (dim) await connector.setBrightness(id, 78);
          if (uncolored) await connector.setColor(id, 38, 72);
        }
        return { content: `${ids.join(", ")} turned ${power}.` };
      }

      case "set_brightness": {
        const id = String(input.id);
        const brightness = Number(input.brightness);
        await comeHome(scheduler);
        await connector.setPower(id, "on");
        await connector.setBrightness(id, brightness);
        return { content: `OK - ${id} brightness set to ${brightness}.` };
      }

      case "set_color": {
        const id = String(input.id);
        const hue = Number(input.hue);
        const saturation = Number(input.saturation);
        await comeHome(scheduler);
        await connector.setPower(id, "on");
        await connector.setColor(id, hue, saturation);
        return { content: `OK - ${id} color set to hue ${hue}, saturation ${saturation}.` };
      }

      case "schedule_recurring_task": {
        const ids = Array.isArray(input.lightIds) && input.lightIds.length
          ? input.lightIds.map((item) => String(item))
          : [String(input.lightId ?? "")].filter((item) => item && item !== "undefined");
        if (!ids.length) return { content: "Which light should I loop?", isError: true };
        await comeHome(scheduler);
        const intervalMs = intervalMsOf(input);
        for (const lightId of ids) {
          for (const task of scheduler.list()) {
            const sameLight = task.lightId === lightId && task.status === "active";
            const replaced = task.action.type === "cycleColor";
            if (sameLight && replaced) scheduler.cancel(task.id);
          }
          await scheduler.schedule({
            lightId,
            description: `cycle ${lightId} color`,
            intervalMs,
            action: toTaskAction(lightId, input.action),
          });
        }
        const every =
          input.intervalSeconds != null
            ? `${input.intervalSeconds} sec`
            : `${input.intervalMinutes} min`;
        return {
          content: `Scheduled ${ids.join(", ")} every ${every}. Other color loops stay running.`,
        };
      }

      case "list_scheduled_tasks": {
        const list = scheduler.list();
        if (!list.length) return { content: "No scheduled tasks." };
        return {
          content: list
            .map(
              (t) =>
                `${t.id}: ${t.description} - ${t.status}, runs=${t.runCount}` +
                (t.lastError ? `, lastError=${t.lastError}` : "")
            )
            .join("\n"),
        };
      }

      case "cancel_scheduled_task": {
        const ids = Array.isArray(input.taskIds) && input.taskIds.length
          ? input.taskIds.map((item) => String(item))
          : [String(input.taskId ?? "")].filter((item) => item && item !== "undefined");
        if (!ids.length) return { content: "Which loop?", isError: true };
        const cancelled = ids.filter((id) => scheduler.cancel(id));
        return {
          content: cancelled.length ? `Cancelled ${cancelled.join(", ")}.` : "No matching loop.",
          isError: cancelled.length === 0,
        };
      }

      case "loop_status": {
        const taskId = input.taskId ? String(input.taskId) : undefined;
        return {
          content: JSON.stringify({
            tasks: scheduler.list(),
            events: scheduler.recentEvents(taskId),
          }),
        };
      }

      case "simulate_miss": {
        const id = String(input.id);
        if (typeof connector.armMiss !== "function") {
          return {
            content: "This connector cannot drop a write. Switch to LIGHT_CONNECTOR=mock for the miss demo.",
            isError: true,
          };
        }
        connector.armMiss(id);
        return {
          content: `Armed a one-time miss for ${id}. The next loop apply will fail verification once, then retry.`,
        };
      }

      case "set_presence": {
        const mode = String(input.mode) === "home" ? "home" : "away";
        if (mode === "away") {
          const known = await connector.listLights();
          const scene: PresenceSceneLight[] = [];
          for (const light of known) {
            const state = await connector.getState(light.id);
            scene.push({
              id: light.id,
              power: state.power,
              brightness: state.brightness,
              hue: state.hue,
              saturation: state.saturation,
            });
          }
          savePresence({ mode: "away", since: new Date().toISOString(), scene });
          for (const task of scheduler.list()) {
            if (task.status === "active") scheduler.cancel(task.id);
          }
          for (const light of scene) {
            await scheduler.schedule({
              lightId: light.id,
              description: AWAY_MARK,
              intervalMs: AWAY_EVERY_MS,
              action: { type: "setPower", id: light.id, power: "off" },
            });
          }
          const speech = "You're away. I saved the room, and I'll turn the lights back off if they come on.";
          return { content: speech, speech };
        }

        const saved = loadPresence();
        for (const task of scheduler.list()) {
          if (task.description === AWAY_MARK) scheduler.cancel(task.id);
        }
        await scheduler.idle();
        if (!saved.scene.length) {
          savePresence({ mode: "home", since: new Date().toISOString(), scene: [] });
          return {
            content: "I don't have a saved room yet. Say you're leaving first.",
            speech: "I don't have a saved room yet. Say you're leaving first.",
            isError: true,
          };
        }
        for (const light of saved.scene) {
          await connector.setPower(light.id, light.power);
          if (light.power === "on" && light.brightness != null) {
            await connector.setBrightness(light.id, light.brightness);
          }
          if (light.power === "on" && light.hue != null && light.saturation != null) {
            await connector.setColor(light.id, light.hue, light.saturation);
          }
        }
        savePresence({ mode: "home", since: new Date().toISOString(), scene: saved.scene });
        const speech = "Welcome back. The room is as you left it.";
        return { content: speech, speech };
      }

      case "match_weather": {
        const look = await currentWeather({
          place: input.place ? String(input.place) : undefined,
          latitude: finite(input.latitude),
          longitude: finite(input.longitude),
        });
        const known = await connector.listLights();
        const ids = input.id ? [String(input.id)] : known.map((light) => light.id);
        if (!ids.length) return { content: "No lights to color.", isError: true };
        const returned = await comeHome(scheduler);
        let paused = 0;
        for (const id of ids) {
          for (const task of scheduler.list()) {
            if (task.lightId === id && task.status === "active" && task.action.type === "cycleColor") {
              scheduler.cancel(task.id);
              paused += 1;
            }
          }
        }
        for (const id of ids) {
          await connector.setPower(id, "on");
          await connector.setBrightness(id, look.brightness);
          await connector.setColor(id, look.hue, look.saturation);
        }
        const target = input.id ? String(input.id) : "The lights";
        const verb = input.id ? "is" : "are";
        const where =
          look.source === "browser"
            ? `${look.place} is ${look.summary}, from this browser's location.`
            : look.source === "network"
              ? `${look.place} is ${look.summary}. That city is this network's location, because the browser did not share one.`
              : look.source === "timezone"
                ? `I could not read a location, so I used ${look.place}. It is ${look.summary}.`
                : `${look.place} is ${look.summary}.`;
        const held = [
          returned ? "You're home again." : "",
          paused ? "I paused the color loops so the lamps stay on this sky." : "",
        ].filter(Boolean).join(" ");
        const speech = `${where} ${target} ${verb} ${look.swatch}.${held ? " " + held : ""}`;
        return {
          content: speech,
          speech,
          sky: {
            place: look.place,
            summary: look.summary,
            swatch: look.swatch,
            hue: look.hue,
            source: look.source,
          },
        };
      }

      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error running ${name}: ${msg}`, isError: true };
  }
}

/** A later command means someone is here. Stop the away hold and show Home. */
async function comeHome(scheduler: TaskScheduler): Promise<boolean> {
  const presence = loadPresence();
  for (const task of scheduler.list()) {
    if (task.status === "active" && task.description === AWAY_MARK) scheduler.cancel(task.id);
  }
  await scheduler.idle();
  if (presence.mode !== "away") return false;
  savePresence({ mode: "home", since: new Date().toISOString(), scene: presence.scene });
  return true;
}

/** Seconds win when both are present. Floor is one second so a loop cannot spin the process. */
function finite(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function intervalMsOf(input: Record<string, unknown>): number {
  const seconds =
    input.intervalSeconds != null && input.intervalSeconds !== ""
      ? Number(input.intervalSeconds)
      : Number(input.intervalMinutes) * 60;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Provide intervalSeconds or intervalMinutes");
  }
  return Math.max(1000, Math.round(seconds * 1000));
}

/** Validate + narrow Claude's loosely-typed action object into a TaskAction. */
function toTaskAction(id: string, raw: unknown): TaskAction {
  if (typeof raw !== "object" || raw === null)
    throw new Error("action must be an object");
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case "setPower":
      if (a.power !== "on" && a.power !== "off")
        throw new Error("setPower requires power 'on' or 'off'");
      return { type: "setPower", id, power: a.power };
    case "setBrightness":
      return { type: "setBrightness", id, brightness: Number(a.brightness) };
    case "setColor":
      return {
        type: "setColor",
        id,
        hue: Number(a.hue),
        saturation: Number(a.saturation),
      };
    case "cycleColor":
      return { type: "cycleColor", id };
    default:
      throw new Error(`Unknown action.type: ${String(a.type)}`);
  }
}
