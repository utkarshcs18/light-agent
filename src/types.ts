/**
 * Shared contracts. The agent and the scheduler talk to LightConnector only.
 */

export type Power = "on" | "off";

export interface LightState {
  power: Power;
  /** 0–100 */
  brightness?: number;
  /** 0–360 */
  hue?: number;
  /** 0–100 */
  saturation?: number;
}

/** A named light. `host` is the LAN address Kasa needs. */
export interface DeviceInfo {
  id: string;
  alias?: string;
  host?: string;
  model?: string;
  mac?: string;
}

export interface LightConnector {
  listLights(): Promise<DeviceInfo[]>;
  getState(id: string): Promise<LightState>;
  setPower(id: string, power: Power): Promise<void>;
  setBrightness(id: string, brightness: number): Promise<void>;
  setColor(id: string, hue: number, saturation: number): Promise<void>;
  /** Demo only. The next scheduler apply on this light fails verification once. */
  armMiss?(id: string): void;
  /** Returns true once after armMiss, then clears. The scheduler skips that apply. */
  consumeMiss?(id: string): boolean;
}

export type TaskAction =
  | { type: "setPower"; id: string; power: Power }
  | { type: "setBrightness"; id: string; brightness: number }
  | { type: "setColor"; id: string; hue: number; saturation: number }
  | { type: "cycleColor"; id: string };

export type TaskStatus = "active" | "error" | "stopped";

/** One step of a tick, shared by loop_status and the Alexa+ trace cards. */
export type LoopPhase = "apply" | "mismatch" | "retry" | "verified" | "failed";

export interface LoopEvent {
  taskId: string;
  lightId: string;
  phase: LoopPhase;
  attempt: number;
  intended?: Partial<LightState>;
  at: string;
  detail?: string;
  /** Ticks never call a model. Present so the card can show that from the event itself. */
  modelCall: false;
}

export interface ScheduledTask {
  id: string;
  lightId: string;
  description: string;
  intervalMs: number;
  action: TaskAction;
  status: TaskStatus;
  runCount: number;
  lastRun?: Date;
  lastError?: string;
}
