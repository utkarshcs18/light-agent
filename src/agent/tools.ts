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
      "Schedule a recurring action on a light that runs every N minutes until cancelled (e.g. 'cycle the kitchen color every 5 minutes', or 'dim the bedroom to 20 every hour'). Each run executes the action and verifies it. Use action.type 'cycleColor' for requests that ask to change/rotate/cycle colors over time.",
    input_schema: {
      type: "object",
      properties: {
        lightId: { type: "string", description: "The friendly light id to act on." },
        intervalMinutes: {
          type: "number",
          minimum: 0.1,
          description: "How often to run, in minutes.",
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
      required: ["lightId", "intervalMinutes", "description", "action"],
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
];
