import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadStoredTasks, saveStoredTasks } from "./taskStore.js";
import type { PersistedTask } from "./scheduler.js";

describe("tasks.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "light-agent-tasks-"));
  const previous = process.env.TASKS_FILE;

  after(() => {
    if (previous === undefined) delete process.env.TASKS_FILE;
    else process.env.TASKS_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips active loops", () => {
    process.env.TASKS_FILE = join(dir, "tasks.json");
    const tasks: PersistedTask[] = [
      {
        id: "abc12345",
        lightId: "kitchen",
        description: "cycle kitchen color",
        intervalMs: 5000,
        action: { type: "cycleColor", id: "kitchen" },
        status: "active",
        runCount: 2,
        hue: 90,
      },
    ];
    saveStoredTasks(tasks);
    assert.deepEqual(loadStoredTasks(), tasks);
  });
});
