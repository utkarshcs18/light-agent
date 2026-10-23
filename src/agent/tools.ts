/**
 * tools.ts - Anthropic tool schemas (the bridge between Claude and the app).
 *
 * Light tools map to the LightConnector; scheduling tools map to the TaskScheduler.
 * Each `description` matters - it is how Claude decides which tool to call and with what args.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const tools: Anthropic.Tool[] = [
  // ---- Light tools (-> connector) ----
  {
    name: "list_lights",
    description:
      "List all known lights (their friendly ids, aliases and models). Call this when the user asks what lights exist, or when you are unsure which id to use.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_state",
    description:
      "Get the current state (power, brightness, hue, saturation) of one light by its id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The friendly light id, e.g. 'living-room'." },
      },
      required: ["id"],
    },
  },
  {
    name: "set_power",
    description: "Turn a light on or off.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The friendly light id." },
        power: { type: "string", enum: ["on", "off"] },
      },
      required: ["id", "power"],
    },
  },
  {
    name: "set_brightness",
    description:
      "Set a light's brightness from 0 to 100. Turn the light on first if it is off.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The friendly light id." },
        brightness: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Brightness percentage, 0-100.",
        },
      },
      required: ["id", "brightness"],
    },
  },
  {
    name: "set_color",
    description:
      "Set a light's color using HSV hue (0-360) and saturation (0-100). Examples: red=hue 0, green=120, blue=240. Use saturation 100 for a vivid color.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The friendly light id." },
        hue: { type: "integer", minimum: 0, maximum: 360, description: "Hue in degrees, 0-360." },
        saturation: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Saturation percentage, 0-100.",
        },
      },
      required: ["id", "hue", "saturation"],
    },
  },

  // ---- Scheduling tools (-> scheduler) ----
  {
    name: "schedule_recurring_task",
    description:
      "Schedule a recurring action on a light that repeats until cancelled. Each run executes the action and verifies the bulb, with no model call. Use intervalSeconds for periods under a minute (every 5 seconds -> 5). Use action.type 'cycleColor' when the user asks to change, rotate, or cycle colors.",
    input_schema: {
      type: "object",
      properties: {
        lightId: { type: "string", description: "The friendly light id to act on." },
        intervalMinutes: {
          type: "number",
          minimum: 0.02,
          description:
            "How often to run, in minutes. For a period under a minute, prefer intervalSeconds.",
        },
        intervalSeconds: {
          type: "number",
          minimum: 1,
          description:
            "How often to run, in seconds. Use this for 'every 5 seconds' (value 5). Minimum 1.",
        },
        description: {
          type: "string",
          description: "A short human-readable summary of the task, e.g. 'cycle kitchen color'.",
        },
        action: {
          type: "object",
          description: "The structured action to run each interval.",
          properties: {
            type: {
              type: "string",
              enum: ["setPower", "setBrightness", "setColor", "cycleColor"],
            },
            power: { type: "string", enum: ["on", "off"], description: "For type 'setPower'." },
            brightness: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description: "For type 'setBrightness'.",
            },
            hue: { type: "integer", minimum: 0, maximum: 360, description: "For type 'setColor'." },
            saturation: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description: "For type 'setColor'.",
            },
          },
          required: ["type"],
        },
      },
      required: ["lightId", "description", "action"],
    },
  },
  {
    name: "list_scheduled_tasks",
    description:
      "List all recurring tasks with their ids, status (active/error/stopped), run counts and any last error.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancel_scheduled_task",
    description: "Cancel and remove a recurring task by its id.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The id returned by schedule_recurring_task." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "loop_status",
    description:
      "Return the latest verify / retry trace for recurring tasks (phases: apply, mismatch, retry, verified, failed). Omit taskId to read every loop. Use this when the user asks whether a loop checked the bulb.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Optional task id. Omit for every loop." },
      },
      required: [],
    },
  },
  {
    name: "simulate_miss",
    description:
      "Demo only, mock connector. Drop the next scheduled write for one light so verification fails once and the loop retries. Use when the user says to drop, skip, or miss the next write.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The friendly light id, e.g. 'kitchen'." },
      },
      required: ["id"],
    },
  },
  {
    name: "match_weather",
    description:
      "Set a light's color from the current weather, or every light if id is omitted. Use when the user wants the bulbs to match, follow, or adapt to the weather. Optional place is a city.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Friendly light id. Omit to color every light." },
        place: { type: "string", description: "City name. Omit to use the caller's coordinates or this machine's location." },
        latitude: { type: "number", description: "Latitude from the browser. Omit when place is set." },
        longitude: { type: "number", description: "Longitude from the browser. Omit when place is set." },
      },
      required: [],
    },
  },
  {
    name: "set_presence",
    description:
      "Remember who is home. away saves every bulb and keeps the lights off. home restores that room and stops the watch.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["home", "away"], description: "away when they leave. home when they return." },
      },
      required: ["mode"],
    },
  },
];
