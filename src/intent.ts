/**
 * intent.ts - compile a spoken line into one MCP tool call.
 *
 * The demo phrases resolve here, with no model call. Anything this does not
 * recognize falls through to Claude when an API key is configured.
 */

import type { DeviceInfo, ScheduledTask } from "./types.js";

export type CompiledCall = {
  kind: "call";
  tool: string;
  args: Record<string, unknown>;
};

export type CompiledClarify = {
  kind: "clarify";
  speech: string;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  sixty: 60,
};

const COLORS: Record<string, [number, number]> = {
  red: [0, 100],
  orange: [28, 100],
  amber: [32, 90],
  yellow: [52, 100],
  warm: [28, 48],
  green: [132, 90],
  cyan: [180, 80],
  blue: [214, 90],
  purple: [272, 80],
  pink: [330, 70],
  white: [0, 0],
};

export function compileUtterance(
  utterance: string,
  lights: DeviceInfo[],
  tasks: ScheduledTask[]
): CompiledCall | CompiledClarify | null {
  const text = normalize(utterance);
  if (!text) return { kind: "clarify", speech: "I didn't catch that." };

  if (isList(text)) {
    return { kind: "call", tool: "list_scheduled_tasks", args: {} };
  }

  if (isMiss(text)) {
    const id = matchLight(text, lights) ?? onlyLight(lights);
    if (!id) return { kind: "clarify", speech: "Which light should miss the next write?" };
    return { kind: "call", tool: "simulate_miss", args: { id } };
  }

  if (isAway(text)) {
    return { kind: "call", tool: "set_presence", args: { mode: "away" } };
  }

  if (isHome(text)) {
    return { kind: "call", tool: "set_presence", args: { mode: "home" } };
  }

  if (/\b(cancel|stop|end|halt)\b/.test(text)) {
    const targeted = matchLights(text, lights);
    const broad = /\b(everything|all|loops?|tasks?|cycles?|cycling|schedule|them|it)\b/.test(text);
    if (targeted.length || broad) {
      const active = tasks.filter(
        (task) => task.status === "active" && (!targeted.length || targeted.includes(task.lightId))
      );
      if (!active.length) return { kind: "clarify", speech: "Nothing is looping right now." };
      return {
        kind: "call",
        tool: "cancel_scheduled_task",
        args: { taskIds: active.map((task) => task.id) },
      };
    }
  }

  if (isWeather(text)) {
    const lightId = matchLight(text, lights);
    const place = weatherPlace(text, lights);
    return {
      kind: "call",
      tool: "match_weather",
      args: {
        ...(lightId ? { id: lightId } : {}),
        ...(place ? { place } : {}),
      },
    };
  }

  if (isCycle(text) || isStartLoop(text)) {
    const every = parseEvery(text) ?? { seconds: 5 };
    const ids = wantsAllLights(text) ? lights.map((light) => light.id) : matchLights(text, lights);
    const chosen = ids.length ? ids : onlyLight(lights) ? [onlyLight(lights) as string] : [];
    if (!chosen.length) return { kind: "clarify", speech: "Which lights should I loop?" };
    const shared = {
      intervalSeconds: every.seconds,
      description: chosen.length > 1 ? `cycle ${chosen.join(" and ")}` : `cycle ${chosen[0]} color`,
      action: { type: "cycleColor" },
    };
    if (chosen.length === 1) {
      return {
        kind: "call",
        tool: "schedule_recurring_task",
        args: { lightId: chosen[0], ...shared },
      };
    }
    return {
      kind: "call",
      tool: "schedule_recurring_task",
      args: { lightIds: chosen, ...shared },
    };
  }

  if (isPower(text) || (/\b(on|off)\b/.test(text) && (wantsAllLights(text) || matchLights(text, lights).length > 0))) {
    const power = wantsOff(text) ? "off" : "on";
    const ids = wantsAllLights(text) ? lights.map((light) => light.id) : matchLights(text, lights);
    const chosen = ids.length ? ids : onlyLight(lights) ? [onlyLight(lights) as string] : [];
    if (!chosen.length) return { kind: "clarify", speech: "Which lights?" };
    return {
      kind: "call",
      tool: "set_power",
      args: chosen.length === 1 ? { id: chosen[0], ids: chosen, power } : { ids: chosen, power },
    };
  }

  const percent = text.match(/\b(\d+)\s*(%|percent)\b/);
  if (percent && /\b(bright|dim|warm|set|percent)\b/.test(text)) {
    const lightId = matchLight(text, lights) ?? onlyLight(lights);
    if (!lightId) return { kind: "clarify", speech: "Which light should I dim?" };
    return {
      kind: "call",
      tool: "set_brightness",
      args: { id: lightId, brightness: Number(percent[1]) },
    };
  }

  const colorName = matchColor(text);
  if (colorName && !isCycle(text)) {
    const lightId = matchLight(text, lights) ?? onlyLight(lights);
    if (!lightId) return { kind: "clarify", speech: "Which light should I recolor?" };
    const [hue, saturation] = COLORS[colorName];
    return { kind: "call", tool: "set_color", args: { id: lightId, hue, saturation } };
  }

  return {
    kind: "clarify",
    speech:
      "I do that on this machine, with no model. Cycle the kitchen, turn the lights off, drop the next kitchen write, match the weather, or say I'm leaving.",
  };
}

function normalize(utterance: string): string {
  return utterance
    .toLowerCase()
    .replace(/[.,!?;:"']/g, " ")
    .replace(/\balexa\b\+?/g, " ")
    .replace(/\bt\s+urn\b/g, "turn")
    .replace(/\bo\s+n\b/g, "on")
    .replace(/\bo\s+ff\b/g, "off")
    .replace(/\s+/g, " ")
    .trim();
}

function isList(text: string): boolean {
  return (
    /\b(what|which|any|show)\b.*\b(loops?|tasks?|running)\b/.test(text) ||
    /\b(loops?|tasks?)\b.*\b(running|active|going)\b/.test(text) ||
    /\bwhat s running\b/.test(text)
  );
}

function isMiss(text: string): boolean {
  return (
    (/\b(drop|skip|miss|fail)\b/.test(text) && /\b(write|update|command|tick|apply)\b/.test(text)) ||
    /\bdrop the next\b/.test(text)
  );
}

function isStartLoop(text: string): boolean {
  return (
    (/\b(run|start|begin|loop)\b/.test(text) && /\b(loops?|cycles?|cycling)\b/.test(text)) ||
    /\bloop the\b/.test(text)
  );
}

function isPower(text: string): boolean {
  return /\b(turns?|trun|tunr|switch|shut)\b/.test(text) && /\b(on|off|of|out)\b/.test(text);
}

function wantsOff(text: string): boolean {
  return /\b(off|of|out)\b/.test(text) && !/\bon\b/.test(text);
}

function wantsAllLights(text: string): boolean {
  return (
    (/\b(all|every)\b/.test(text) && /\b(lights?|bulbs?|rooms?)\b/.test(text)) ||
    /\bthe lights\b/.test(text)
  );
}

function isCycle(text: string): boolean {
  return (
    /\bcycle\b/.test(text) ||
    (/\b(rotate|shift)\b/.test(text) && /\b(colours?|colors?|hues?)\b/.test(text)) ||
    /\bchange the (colours?|colors?)\b/.test(text)
  );
}

function isAway(text: string): boolean {
  return (
    /\b(i m|i am|we re|we are)\s+(leaving|out|gone|away)\b/.test(text) ||
    /\baway mode\b/.test(text) ||
    /\bkeep the (house|home|lights) (dark|off)\b/.test(text)
  );
}

function isHome(text: string): boolean {
  return /\b(i m|i am|we re|we are)\s+(back|home)\b/.test(text) || /\bwelcome me home\b/.test(text);
}

function isWeather(text: string): boolean {
  return (
    /\bweather\b/.test(text) ||
    /\blook like the (rain|sky|storm|sun)\b/.test(text) ||
    (/\b(match|adapt|follow)\b/.test(text) && /\b(sky|rain|forecast|storm)\b/.test(text))
  );
}

function weatherPlace(text: string, lights: DeviceInfo[]): string | undefined {
  const match = text.match(/\b(?:in|for|at)\s+([a-z][a-z\s-]{1,40})$/);
  if (!match) return undefined;
  const phrase = match[1].trim().replace(/^the\s+/, "");
  if (matchLight(phrase, lights)) return undefined;
  if (/^(lights|bulbs|house|home|rooms?|me|you|us|here|there|my location|this location|outside|nearby)$/.test(phrase)) {
    return undefined;
  }
  return phrase;
}

function parseEvery(text: string): { seconds: number } | null {
  const match = text.match(
    /\bevery\s+(\d+(?:\.\d+)?|[a-z]+)\s*(seconds|second|secs|sec|minutes|minute|mins|min|s|m)\b/
  );
  if (!match) return null;
  const amount = numberToken(match[1]);
  if (amount == null || amount <= 0) return null;
  const unit = match[2];
  const seconds = unit.startsWith("m") ? amount * 60 : amount;
  return { seconds };
}

function numberToken(raw: string): number | null {
  if (NUMBER_WORDS[raw] != null) return NUMBER_WORDS[raw];
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function matchColor(text: string): string | null {
  const names = Object.keys(COLORS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return name;
  }
  return null;
}

function matchLights(text: string, lights: DeviceInfo[]): string[] {
  const hits: string[] = [];
  for (const light of lights) {
    const names = [light.id, light.alias].filter((name): name is string => Boolean(name));
    const named = names.some((name) => {
      const spaced = name.toLowerCase().replace(/-/g, " ");
      return text.includes(spaced) || text.includes(name.toLowerCase());
    });
    if (named || lightSpokenNear(text, light)) hits.push(light.id);
  }
  return hits;
}

function lightSpokenNear(text: string, light: DeviceInfo): boolean {
  const words = text.split(" ").filter((word) => word.length >= 4);
  const names = [light.id, light.alias]
    .filter((name): name is string => Boolean(name))
    .join(" ")
    .toLowerCase()
    .replace(/-/g, " ")
    .split(" ")
    .filter((name) => name.length >= 4);
  return names.some((name) => words.some((word) => oneEdit(word, name)));
}

function matchLight(text: string, lights: DeviceInfo[]): string | null {
  const ranked = [...lights].sort((a, b) => labelOf(b).length - labelOf(a).length);
  for (const light of ranked) {
    const names = [light.id, light.alias].filter((name): name is string => Boolean(name));
    for (const name of names) {
      const spaced = name.toLowerCase().replace(/-/g, " ");
      if (text.includes(spaced) || text.includes(name.toLowerCase())) return light.id;
    }
  }
  return fuzzyLight(text, lights);
}

function fuzzyLight(text: string, lights: DeviceInfo[]): string | null {
  const words = text.split(" ").filter((word) => word.length >= 5);
  let best: { id: string; score: number } | null = null;
  for (const light of lights) {
    const names = [light.id, light.alias]
      .filter((name): name is string => Boolean(name))
      .join(" ")
      .toLowerCase()
      .replace(/-/g, " ")
      .split(" ")
      .filter((name) => name.length >= 5);
    let score = 0;
    for (const name of names) {
      if (words.some((word) => oneEdit(word, name))) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: light.id, score };
  }
  return best?.id ?? null;
}

function oneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

function labelOf(light: DeviceInfo): string {
  return light.alias ?? light.id;
}

function onlyLight(lights: DeviceInfo[]): string | null {
  return lights.length === 1 ? lights[0].id : null;
}
