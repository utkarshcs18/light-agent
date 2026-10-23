/**
 * scheduler.ts - the loop engine.
 *
 * Each tick runs a structured action, reads the bulb back, and retries with backoff.
 * There is no model call on a tick. Events are phases the Alexa+ cards render.
 * Active loops can be written to tasks.json and resumed after the process starts again.
 */

import { randomUUID } from "node:crypto";
import type {
  LightConnector,
  LightState,
  LoopEvent,
  ScheduledTask,
} from "./types.js";

// How many times a single tick will try to apply + verify before giving up.
const MAX_ATTEMPTS = 3;
// Base backoff between attempts; doubles each retry (200ms, 400ms, ...).
const BASE_BACKOFF_MS = 200;
// cycleColor advances the hue by this many degrees each tick.
const HUE_STEP = 45;
// Keep the trace a card can render without growing forever.
const MAX_EVENTS = 80;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ScheduleInput {
  lightId: string;
  description: string;
  intervalMs: number;
  action: ScheduledTask["action"];
}

export interface ScheduleOptions {
  /** When false, the caller drives ticks (tests). Default true runs one tick now. */
  immediate?: boolean;
}

/** JSON shape of a loop. lastRun is ISO. hue is the cycleColor counter. */
export interface PersistedTask {
  id: string;
  lightId: string;
  description: string;
  intervalMs: number;
  action: ScheduledTask["action"];
  status: ScheduledTask["status"];
  runCount: number;
  lastRun?: string;
  lastError?: string;
  hue?: number;
}

/**
 * TaskScheduler drives recurring tasks. Construct it with a connector (the "hands") and an
 * onEvent callback. Events are structured phases: apply, mismatch, retry, verified, failed.
 */
export class TaskScheduler {
  private connector: LightConnector;
  private onEvent: (event: LoopEvent) => void;
  private persist?: (tasks: PersistedTask[]) => void;
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, NodeJS.Timeout>();
  private inFlight = new Set<string>();
  // Per-task hue counter for cycleColor (keyed by task id).
  private hueCounters = new Map<string, number>();
  private events: LoopEvent[] = [];
  private ticks = 0;

  constructor(
    connector: LightConnector,
    onEvent: (event: LoopEvent) => void = () => {},
    persist?: (tasks: PersistedTask[]) => void
  ) {
    this.connector = connector;
    this.onEvent = onEvent;
    this.persist = persist;
  }

  /**
   * Register a recurring task and start its interval. Returns a short id the user (via Claude)
   * can later pass to cancel_scheduled_task. The first tick runs immediately so a spoken
   * schedule shows up on the card without waiting a full interval.
   */
  async schedule(input: ScheduleInput, options: ScheduleOptions = {}): Promise<string> {
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

    // The tool result should already show the first verify, so the card updates with the reply.
    if (options.immediate !== false) {
      await this.tick(id);
    }
    this.touch();
    return id;
  }

  /** All known tasks (active, error, or stopped). */
  list(): ScheduledTask[] {
    return [...this.tasks.values()];
  }

  /** How many ticks this process has run. A tick never calls a model. */
  tickCount(): number {
    return this.ticks;
  }

  /** Latest verify / retry events, newest last. Optional task filter. */
  recentEvents(taskId?: string): LoopEvent[] {
    const list = taskId ? this.events.filter((e) => e.taskId === taskId) : this.events;
    return list.map((e) => ({ ...e, intended: e.intended ? { ...e.intended } : undefined }));
  }

  /** Stop and remove a single task. Returns false if the id is unknown. */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) clearInterval(timer);
    this.timers.delete(id);
    this.hueCounters.delete(id);
    const removed = this.tasks.delete(id);
    if (removed) this.touch();
    return removed;
  }

  /** Stop and remove every task, and persist the empty list. */
  cancelAll(): void {
    this.halt();
    this.tasks.clear();
    this.hueCounters.clear();
    this.touch();
  }

  /** Wait until no tick is mid-apply, so a restore is not overwritten. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await sleep(20);
    }
  }

  /** Stop timers without forgetting the loops. Used when the process exits. */
  halt(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  /** Snapshot for tasks.json. */
  exportState(): PersistedTask[] {
    return this.list().map((task) => ({
      id: task.id,
      lightId: task.lightId,
      description: task.description,
      intervalMs: task.intervalMs,
      action: task.action,
      status: task.status,
      runCount: task.runCount,
      lastRun: task.lastRun?.toISOString(),
      lastError: task.lastError,
      hue: this.hueCounters.get(task.id),
    }));
  }

  /** Resume loops saved from an earlier process. Active ones start ticking again. */
  restore(saved: PersistedTask[]): void {
    for (const item of saved) {
      if (!item?.id || !item.lightId || !item.action || item.status === "stopped") continue;
      const task: ScheduledTask = {
        id: item.id,
        lightId: item.lightId,
        description: item.description,
        intervalMs: item.intervalMs,
        action: item.action,
        status: item.status === "error" ? "error" : "active",
        runCount: item.runCount ?? 0,
        lastRun: item.lastRun ? new Date(item.lastRun) : undefined,
        lastError: item.lastError,
      };
      this.tasks.set(task.id, task);
      if (typeof item.hue === "number") this.hueCounters.set(task.id, item.hue);
      if (task.status !== "active") continue;
      const timer = setInterval(() => {
        void this.tick(task.id);
      }, task.intervalMs);
      this.timers.set(task.id, timer);
    }
  }

  /** Drive one tick from a test. Production ticks come from the interval. */
  runTick(id: string): Promise<void> {
    return this.tick(id);
  }

  /** One interval: apply the action, verify it, retry with backoff, update bookkeeping. */
  private async tick(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.status === "error") return;
    if (this.inFlight.has(id)) return;
    this.inFlight.add(id);

    try {
      await this.attemptTick(id);
    } finally {
      this.inFlight.delete(id);
      this.touch();
    }
  }

  private async attemptTick(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.status === "error") return;
    this.ticks += 1;

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let intended: Partial<LightState> = {};
      try {
        intended = await this.apply(task, attempt);
        const ok = await this.verify(task.lightId, intended);
        if (ok) {
          task.runCount++;
          task.lastRun = new Date();
          task.lastError = undefined;
          task.status = "active";
          this.emit(task, "verified", attempt, intended, `run #${task.runCount}`);
          return;
        }
        lastError = "state did not match intended action after apply";
        this.emit(task, "mismatch", attempt, intended, lastError);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.emit(task, "mismatch", attempt, intended, lastError);
      }

      if (attempt < MAX_ATTEMPTS) {
        this.emit(task, "retry", attempt, intended, `backoff ${BASE_BACKOFF_MS * 2 ** (attempt - 1)}ms`);
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }

    task.status = "error";
    task.lastError = lastError;
    task.lastRun = new Date();
    this.emit(task, "failed", MAX_ATTEMPTS, undefined, lastError);
    this.clearTimer(id);
  }

  /**
   * Map a TaskAction to a connector call and return the intended LightState (used by verify).
   * cycleColor advances a per-task hue counter each tick so the color changes over time.
   * A consumed miss skips the write so the following verify fails once.
   */
  private async apply(task: ScheduledTask, attempt: number): Promise<Partial<LightState>> {
    const action = task.action;
    const dropped = this.connector.consumeMiss?.(task.lightId) === true;
    // A dropped write must retry the same color step, so cycleColor commits hue only on a real apply.
    const intended = this.intendedState(task, action, !dropped);
    this.emit(
      task,
      "apply",
      attempt,
      intended,
      dropped ? "dropped write" : action.type
    );
    if (dropped) return intended;

    switch (action.type) {
      case "setPower":
        await this.connector.setPower(task.lightId, action.power);
        return intended;

      case "setBrightness":
        await this.connector.setPower(task.lightId, "on");
        await this.connector.setBrightness(task.lightId, action.brightness);
        return intended;

      case "setColor":
        await this.connector.setPower(task.lightId, "on");
        await this.connector.setColor(task.lightId, action.hue, action.saturation);
        return intended;

      case "cycleColor":
        await this.connector.setPower(task.lightId, "on");
        await this.connector.setColor(task.lightId, intended.hue ?? 0, intended.saturation ?? 100);
        return intended;

      default: {
        const _never: never = action;
        throw new Error(`Unknown action: ${JSON.stringify(_never)}`);
      }
    }
  }

  /** Intended state for this apply. cycleColor commits the next hue only when the write is real. */
  private intendedState(
    task: ScheduledTask,
    action: ScheduledTask["action"],
    commitHue: boolean
  ): Partial<LightState> {
    switch (action.type) {
      case "setPower":
        return { power: action.power };
      case "setBrightness":
        return { power: "on", brightness: action.brightness };
      case "setColor":
        return { power: "on", hue: action.hue, saturation: action.saturation };
      case "cycleColor": {
        const prev = this.hueCounters.get(task.id) ?? 0;
        const hue = (prev + HUE_STEP) % 360;
        if (commitHue) this.hueCounters.set(task.id, hue);
        return { power: "on", hue, saturation: 100 };
      }
      default: {
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

  private emit(
    task: ScheduledTask,
    phase: LoopEvent["phase"],
    attempt: number,
    intended: Partial<LightState> | undefined,
    detail?: string
  ): void {
    const event: LoopEvent = {
      taskId: task.id,
      lightId: task.lightId,
      phase,
      attempt,
      intended: intended ? { ...intended } : undefined,
      at: new Date().toISOString(),
      detail,
      modelCall: false,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.onEvent(event);
  }

  private touch(): void {
    this.persist?.(this.exportState());
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearInterval(timer);
    this.timers.delete(id);
  }
}
