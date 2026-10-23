import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MockConnector } from "./connector/mockConnector.js";
import { TaskScheduler } from "./scheduler.js";
import type { DeviceInfo, LightConnector, LightState, Power } from "./types.js";

const kitchen: DeviceInfo = { id: "kitchen", alias: "Kitchen" };

describe("scheduler verify loop", () => {
  const schedulers: TaskScheduler[] = [];

  after(() => {
    for (const scheduler of schedulers) scheduler.cancelAll();
  });

  it("one dropped write retries and stays active", async () => {
    const connector = new MockConnector([kitchen]);
    const scheduler = new TaskScheduler(connector);
    schedulers.push(scheduler);

    const id = await scheduler.schedule(
      {
        lightId: "kitchen",
        description: "cycle kitchen color",
        intervalMs: 60_000,
        action: { type: "cycleColor", id: "kitchen" },
      },
      { immediate: false }
    );
    connector.armMiss("kitchen");
    await scheduler.runTick(id);

    const task = scheduler.list().find((item) => item.id === id);
    assert.equal(task?.status, "active");
    assert.equal(task?.runCount, 1);
    assert.equal(scheduler.tickCount(), 1);
    assert.equal(scheduler.recentEvents(id).every((event) => event.modelCall === false), true);
    assert.deepEqual(
      scheduler.recentEvents(id).map((event) => event.phase),
      ["apply", "mismatch", "retry", "apply", "verified"]
    );

    const state = await connector.getState("kitchen");
    assert.equal(state.power, "on");
    assert.equal(state.hue, 45);
    assert.equal(state.saturation, 100);
  });

  it("three misses become error", async () => {
    const connector = new DeafConnector();
    const scheduler = new TaskScheduler(connector);
    schedulers.push(scheduler);

    const id = await scheduler.schedule(
      {
        lightId: "kitchen",
        description: "cycle kitchen color",
        intervalMs: 60_000,
        action: { type: "cycleColor", id: "kitchen" },
      },
      { immediate: false }
    );
    await scheduler.runTick(id);

    const task = scheduler.list().find((item) => item.id === id);
    assert.equal(task?.status, "error");
    assert.equal(task?.runCount, 0);
    const phases = scheduler.recentEvents(id).map((event) => event.phase);
    assert.equal(phases.filter((phase) => phase === "mismatch").length, 3);
    assert.equal(phases.at(-1), "failed");
    assert.equal(phases.includes("verified"), false);
  });

  it("resumes a saved loop at the same hue", async () => {
    const connector = new MockConnector([kitchen]);
    const saved: ReturnType<TaskScheduler["exportState"]> = [];
    const recording = new TaskScheduler(connector, () => {}, (tasks) => {
      saved.splice(0, saved.length, ...tasks);
    });
    schedulers.push(recording);

    const id = await recording.schedule(
      {
        lightId: "kitchen",
        description: "cycle kitchen color",
        intervalMs: 60_000,
        action: { type: "cycleColor", id: "kitchen" },
      },
      { immediate: true }
    );
    recording.halt();

    const second = new TaskScheduler(connector);
    schedulers.push(second);
    second.restore(saved);
    assert.equal(second.list()[0]?.id, id);
    assert.equal(second.list()[0]?.status, "active");
    await second.runTick(id);
    assert.equal((await connector.getState("kitchen")).hue, 90);
  });
});

/** Writes never stick, so every verify fails. */
class DeafConnector implements LightConnector {
  private state: LightState = { power: "off", brightness: 50, hue: 0, saturation: 0 };

  async listLights(): Promise<DeviceInfo[]> {
    return [kitchen];
  }

  async getState(): Promise<LightState> {
    return { ...this.state };
  }

  async setPower(_id: string, _power: Power): Promise<void> {}

  async setBrightness(_id: string, _brightness: number): Promise<void> {}

  async setColor(_id: string, _hue: number, _saturation: number): Promise<void> {}
}
