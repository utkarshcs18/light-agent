/**
 * scheduler.ts - the loop engine for recurring async tasks.
 *
 * Owns recurring tasks. Each tick runs a *structured* action (no LLM call per tick),
 * verifies the result by re-reading the light's state, and retries with backoff before
 * marking the task as "error". Claude is only involved once, at schedule time, to turn a
 * natural-language request into a schedule_recurring_task call.
 *
 * Uses node:crypto randomUUID for ids. setInterval keeps the process alive (REPL must stay open).
 */

import { randomUUID } from "node:crypto";
import type {
  LightConnector,
  ScheduledTask,
  LightState,
} from "./types.js";

// How many times a single tick will try to apply + verify before giving up.
const MAX_ATTEMPTS = 3;
// Base backoff between attempts; doubles each retry (200ms, 400ms, ...).
const BASE_BACKOFF_MS = 200;
// cycleColor advances the hue by this many degrees each tick.
const HUE_STEP = 45;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * TaskScheduler drives recurring tasks. Construct it with a connector (the "hands") and an
 * onEvent callback used to surface status lines to the REPL.
 */
export class TaskScheduler {
  private connector: LightConnector;
  private onEvent: (msg: string) => void;
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, NodeJS.Timeout>();
  // Per-task hue counter for cycleColor (keyed by task id).
  private hueCounters = new Map<string, number>();

  constructor(connector: LightConnector, onEvent: (msg: string) => void) {
    this.connector = connector;
    this.onEvent = onEvent;
  }

  /**
   * Register a recurring task and start its interval. Returns a short id the user (via Claude)
   * can later pass to cancel_scheduled_task. The first tick fires after one interval.
   */
  schedule(
    input: Omit<
      ScheduledTask,
      "id" | "status" | "runCount" | "lastRun" | "lastError"
    >
  ): string {
    const id = randomUUID().slice(0, 8);
    const task: ScheduledTask = {
      ...input,
      id,
      status: "active",
      runCount: 0,
    };
    this.tasks.set(id, task);

    const timer = setInterval(() => {
      // Fire-and-forget: tick handles its own errors so a rejection never crashes the process.
      void this.tick(id);
    }, task.intervalMs);
    this.timers.set(id, timer);

    return id;
  }

  /** All known tasks (active, error, or stopped). */
  list(): ScheduledTask[] {
    return [...this.tasks.values()];
  }

  /** Stop and remove a single task. Returns false if the id is unknown. */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) clearInterval(timer);
    this.timers.delete(id);
    this.hueCounters.delete(id);
    return this.tasks.delete(id);
  }

  /** Stop and remove every task (called on REPL exit). */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.tasks.clear();
    this.hueCounters.clear();
  }

  /** One interval: apply the action, verify it, retry with backoff, update bookkeeping. */
  private async tick(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const intended = await this.apply(task);
        const ok = await this.verify(task.lightId, intended);
        if (ok) {
          task.runCount++;
          task.lastRun = new Date();
          task.lastError = undefined;
          task.status = "active";
          this.onEvent(
            `[task ${id}] ${task.description} - ok (run #${task.runCount})`
          );
          return;
        }
        lastError = "state did not match intended action after apply";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      // Back off before the next attempt (no wait after the final attempt).
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }

    // All attempts exhausted.
    task.status = "error";
    task.lastError = lastError;
    task.lastRun = new Date();
    this.onEvent(
      `[task ${id}] ${task.description} - FAILED after ${MAX_ATTEMPTS} attempts: ${lastError}`
    );
  }

  /**
   * Map a TaskAction to a connector call and return the intended LightState (used by verify).
   * cycleColor advances a per-task hue counter each tick so the color changes over time.
   */
  private async apply(task: ScheduledTask): Promise<Partial<LightState>> {
    const action = task.action;
    switch (action.type) {
      case "setPower":
        await this.connector.setPower(task.lightId, action.power);
        return { power: action.power };

      case "setBrightness":
        await this.connector.setPower(task.lightId, "on");
        await this.connector.setBrightness(task.lightId, action.brightness);
        return { power: "on", brightness: action.brightness };

      case "setColor":
        await this.connector.setPower(task.lightId, "on");
        await this.connector.setColor(task.lightId, action.hue, action.saturation);
        return { power: "on", hue: action.hue, saturation: action.saturation };

      case "cycleColor": {
        const prev = this.hueCounters.get(task.id) ?? 0;
        const hue = (prev + HUE_STEP) % 360;
        this.hueCounters.set(task.id, hue);
        await this.connector.setPower(task.lightId, "on");
        await this.connector.setColor(task.lightId, hue, 100);
        return { power: "on", hue, saturation: 100 };
      }

      default: {
        // Exhaustiveness guard: adding a TaskAction variant without handling it fails to compile.
        const _never: never = action;
        throw new Error(`Unknown action: ${JSON.stringify(_never)}`);
      }
    }
  }

  /** Re-read the light and confirm it reflects what we just asked for. */
  private async verify(
    lightId: string,
    intended: Partial<LightState>
  ): Promise<boolean> {
    const state = await this.connector.getState(lightId);
    if (intended.power !== undefined && state.power !== intended.power) return false;
    if (intended.brightness !== undefined && state.brightness !== intended.brightness)
      return false;
    if (intended.hue !== undefined && state.hue !== intended.hue) return false;
    if (intended.saturation !== undefined && state.saturation !== intended.saturation)
      return false;
    return true;
  }
}
