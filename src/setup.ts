/**
 * setup.ts - `npm run setup` entry point: discover, name, and persist Kasa bulbs.
 *
 * Runs LAN discovery for ~5s, then prompts for a friendly id per bulb and writes lights.json.
 * This only finds bulbs already on your WiFi; onboard them once via the Kasa app first.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
// CommonJS interop: import the default and destructure (see kasaConnector.ts for why).
import tplink from "tplink-smarthome-api";
import { saveLights } from "./config.js";

const { Client } = tplink;
import type { DeviceInfo } from "./types.js";

const DISCOVERY_MS = 5000;

/** Turn a bulb alias into a friendly, url-safe id, e.g. "Living Room Lamp" -> "living-room-lamp". */
function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  const client = new Client();
  const found = new Map<string, DeviceInfo>();

  console.log(`Discovering Kasa bulbs on your LAN for ${DISCOVERY_MS / 1000}s...`);

  client.startDiscovery({ deviceTypes: ["bulb"], discoveryTimeout: DISCOVERY_MS });
  client.on("device-new", (device) => {
    const alias = device.alias ?? device.host;
    const info: DeviceInfo = {
      id: slug(alias),
      alias,
      host: device.host,
      model: device.model,
      mac: device.mac,
    };
    found.set(device.host, info);
    console.log(`  found: ${alias} (${device.model}) at ${device.host}`);
  });

  await new Promise<void>((resolve) => setTimeout(resolve, DISCOVERY_MS + 500));
  client.stopDiscovery();

  const bulbs = [...found.values()];
  if (bulbs.length === 0) {
    console.log(
      "\nNo bulbs found. Make sure they are powered on, on the same WiFi, and onboarded via the Kasa app.\n" +
        "(Kasa KL/LB bulbs are supported; Tapo bulbs are not.)"
    );
    process.exit(0);
  }

  const rl = readline.createInterface({ input, output });
  console.log(`\nFound ${bulbs.length} bulb(s). Give each a friendly id (press Enter to accept the default).`);

  const used = new Set<string>();
  for (const bulb of bulbs) {
    const suggested = bulb.id || "bulb";
    let answer = (await rl.question(`  id for "${bulb.alias}" [${suggested}]: `)).trim();
    let id = slug(answer) || suggested;
    // Keep ids unique in case two bulbs share an alias.
    let n = 2;
    while (used.has(id)) id = `${suggested}-${n++}`;
    used.add(id);
    bulb.id = id;
  }
  rl.close();

  saveLights(bulbs);
  console.log(`\nSaved ${bulbs.length} light(s) to lights.json:`);
  for (const b of bulbs) console.log(`  ${b.id} -> ${b.host}`);
  console.log("\nRun `npm run agent` to start controlling them.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
