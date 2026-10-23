import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileUtterance } from "./intent.js";
import type { DeviceInfo, ScheduledTask } from "./types.js";

const lights: DeviceInfo[] = [
  { id: "living-room", alias: "Living room" },
  { id: "kitchen", alias: "Kitchen" },
  { id: "desk", alias: "Desk" },
];

describe("spoken intentions", () => {
  it("compiles the kitchen color cycle", () => {
    const compiled = compileUtterance(
      "Alexa, cycle the kitchen color every five seconds.",
      lights,
      []
    );
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "schedule_recurring_task");
    assert.equal(compiled.args.lightId, "kitchen");
    assert.equal(compiled.args.intervalSeconds, 5);
    assert.deepEqual(compiled.args.action, { type: "cycleColor" });
  });

  it("loops the living room even when the phrase mentions location", () => {
    const compiled = compileUtterance("based on my location can you Loop the living room", lights, []);
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "schedule_recurring_task");
    assert.equal(compiled.args.lightId, "living-room");
    assert.equal(compiled.args.intervalSeconds, 5);
    assert.deepEqual(compiled.args.action, { type: "cycleColor" });
  });

  it("loops one light from a short phrase, and two lights together", () => {
    const one = compileUtterance("Loop living room light", lights, []);
    assert.equal(one?.kind, "call");
    if (one?.kind !== "call") return;
    assert.equal(one.args.lightId, "living-room");

    const both = compileUtterance("loop the living room and the kitchen", lights, []);
    assert.equal(both?.kind, "call");
    if (both?.kind !== "call") return;
    assert.deepEqual(both.args.lightIds, ["living-room", "kitchen"]);
  });

  it("starts a living room loop without a model, even with a slip of the tongue", () => {
    const compiled = compileUtterance("run livingh room loop", lights, []);
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "schedule_recurring_task");
    assert.equal(compiled.args.lightId, "living-room");
    assert.equal(compiled.args.intervalSeconds, 5);
    assert.deepEqual(compiled.args.action, { type: "cycleColor" });
  });

  it("cycles a named light without asking the model how often", () => {
    const compiled = compileUtterance("cycle the kitchen", lights, []);
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "schedule_recurring_task");
    assert.equal(compiled.args.lightId, "kitchen");
    assert.equal(compiled.args.intervalSeconds, 5);
  });

  it("turns the living room on, including a split word", () => {
    for (const phrase of ["turn on living room", "t urn on living room", "Alexa, turn the living room on"]) {
      const compiled = compileUtterance(phrase, lights, []);
      assert.equal(compiled?.kind, "call", phrase);
      if (compiled?.kind !== "call") return;
      assert.equal(compiled.tool, "set_power");
      assert.equal(compiled.args.power, "on");
      assert.equal(compiled.args.id, "living-room");
    }
  });

  it("turns a named light off without the word turn", () => {
    const compiled = compileUtterance("kitchen off", lights, []);
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "set_power");
    assert.deepEqual(compiled.args.ids, ["kitchen"]);
    assert.equal(compiled.args.power, "off");
  });

  it("stops the kitchen loop locally", () => {
    const tasks: ScheduledTask[] = [
      {
        id: "kit-1",
        lightId: "kitchen",
        description: "cycle kitchen",
        intervalMs: 5000,
        action: { type: "cycleColor", id: "kitchen" },
        status: "active",
        runCount: 2,
      },
    ];
    const compiled = compileUtterance("stop the kitchen", lights, tasks);
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "cancel_scheduled_task");
    assert.deepEqual(compiled.args.taskIds, ["kit-1"]);
  });

  it("answers an unknown line locally instead of calling a model", () => {
    const compiled = compileUtterance("please do something surprising", lights, []);
    assert.equal(compiled?.kind, "clarify");
  });

  it("turns off every named light, including a misspoken turn off", () => {
    const compiled = compileUtterance("trun of desk, kitechen and living room", lights, []);
    assert.equal(compiled?.kind, "call");
    if (compiled?.kind !== "call") return;
    assert.equal(compiled.tool, "set_power");
    assert.equal(compiled.args.power, "off");
    assert.deepEqual([...(compiled.args.ids as string[])].sort(), ["desk", "kitchen", "living-room"]);
  });

  it("compiles a dropped write", () => {
    const compiled = compileUtterance("Alexa, drop the next kitchen write.", lights, []);
    assert.deepEqual(compiled, {
      kind: "call",
      tool: "simulate_miss",
      args: { id: "kitchen" },
    });
  });

  it("compiles a loop listing", () => {
    const compiled = compileUtterance("Alexa, what loops are running?", lights, []);
    assert.deepEqual(compiled, { kind: "call", tool: "list_scheduled_tasks", args: {} });
  });

  it("compiles leaving and coming back", () => {
    assert.deepEqual(compileUtterance("Alexa, I'm leaving.", lights, []), {
      kind: "call",
      tool: "set_presence",
      args: { mode: "away" },
    });
    assert.deepEqual(compileUtterance("Alexa, I'm back.", lights, []), {
      kind: "call",
      tool: "set_presence",
      args: { mode: "home" },
    });
  });

  it("compiles a weather color for every light", () => {
    const spoken = compileUtterance("match the weather for me", lights, []);
    assert.equal(spoken?.kind, "call");
    if (spoken?.kind !== "call") return;
    assert.deepEqual(spoken.args, {});

    const compiled = compileUtterance("Alexa, match the lights to the weather.", lights, []);
    assert.deepEqual(compiled, { kind: "call", tool: "match_weather", args: {} });
  });

  it("compiles a weather color for one city and one light", () => {
    const compiled = compileUtterance("Set the kitchen to the weather in Paris.", lights, []);
    assert.deepEqual(compiled, {
      kind: "call",
      tool: "match_weather",
      args: { id: "kitchen", place: "paris" },
    });
  });
});
