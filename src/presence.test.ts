import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadPresence, savePresence } from "./presence.js";

describe("presence.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "light-agent-presence-"));
  const previous = process.env.PRESENCE_FILE;

  after(() => {
    if (previous === undefined) delete process.env.PRESENCE_FILE;
    else process.env.PRESENCE_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("remembers an away room", () => {
    process.env.PRESENCE_FILE = join(dir, "presence.json");
    assert.equal(loadPresence().mode, "home");
    savePresence({
      mode: "away",
      since: "2026-10-23T09:00:00.000Z",
      scene: [{ id: "kitchen", power: "on", brightness: 80, hue: 200, saturation: 40 }],
    });
    assert.deepEqual(loadPresence(), {
      mode: "away",
      since: "2026-10-23T09:00:00.000Z",
      scene: [{ id: "kitchen", power: "on", brightness: 80, hue: 200, saturation: 40 }],
    });
  });
});
