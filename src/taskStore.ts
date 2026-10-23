/**
 * taskStore.ts - tasks.json. Loops survive a process restart.
 * The file is local state, same as lights.json, and is gitignored.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PersistedTask } from "./scheduler.js";

const DEFAULT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "tasks.json");

function tasksFile(): string {
  return process.env.TASKS_FILE || DEFAULT_FILE;
}

export function loadStoredTasks(): PersistedTask[] {
  const file = tasksFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { tasks?: PersistedTask[] };
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

export function saveStoredTasks(tasks: PersistedTask[]): void {
  writeFileSync(tasksFile(), JSON.stringify({ tasks }, null, 2), "utf-8");
}
