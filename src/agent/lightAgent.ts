/**
 * lightAgent.ts - the brain: a Claude tool-use loop.
 *
 * LightAgent.run(userInput) sends the user's text plus the tool schemas to Claude, then loops:
 * while Claude wants a tool, dispatchTool routes it to the connector or the scheduler, feeds the
 * result back, and continues until Claude returns final text.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { DeviceInfo, LightConnector, Power, TaskAction } from "../types.js";
import type { TaskScheduler } from "../scheduler.js";
import { tools } from "./tools.js";
import { buildSystemPrompt } from "./systemPrompt.js";

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
        await connector.setPower(String(input.id), power);
        return { content: `OK - ${input.id} turned ${power}.` };
      }

      case "set_brightness": {
        const id = String(input.id);
        const brightness = Number(input.brightness);
        await connector.setPower(id, "on");
        await connector.setBrightness(id, brightness);
        return { content: `OK - ${id} brightness set to ${brightness}.` };
      }

      case "set_color": {
        const id = String(input.id);
        const hue = Number(input.hue);
        const saturation = Number(input.saturation);
        await connector.setPower(id, "on");
        await connector.setColor(id, hue, saturation);
        return { content: `OK - ${id} color set to hue ${hue}, saturation ${saturation}.` };
      }

      case "schedule_recurring_task": {
        const lightId = String(input.lightId);
        const intervalMs = Math.round(Number(input.intervalMinutes) * 60_000);
        const description = String(input.description);
        const action = toTaskAction(lightId, input.action);
        const id = scheduler.schedule({ lightId, description, intervalMs, action });
        return {
          content: `Scheduled task ${id}: "${description}" every ${input.intervalMinutes} min.`,
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
        const taskId = String(input.taskId);
        const ok = scheduler.cancel(taskId);
        return {
          content: ok ? `Cancelled task ${taskId}.` : `No task with id ${taskId}.`,
          isError: !ok,
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
