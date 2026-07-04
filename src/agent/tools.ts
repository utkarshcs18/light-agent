/**
 * tools.ts - Anthropic tool schemas (the bridge between Claude and the app).
 *
 * TODO: export an Anthropic.Tool[] with JSON input_schema for:
 *   Light tools (-> connector):
 *     - list_lights, get_state, set_power (id, power),
 *       set_brightness (id, brightness), set_color (id, hue, saturation)
 *   Scheduling tools (-> scheduler):
 *     - schedule_recurring_task (lightId, intervalMinutes, action, description)
 *     - list_scheduled_tasks
 *     - cancel_scheduled_task (taskId)
 *
 * Keep each `description` clear - it is how Claude decides which tool to call.
 */
