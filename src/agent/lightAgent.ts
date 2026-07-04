/**
 * lightAgent.ts - the brain: a Claude tool-use loop.
 *
 * TODO:
 *   - class LightAgent(client: Anthropic, connector, scheduler, model, lights)
 *   - async run(userInput): string
 *       messages = [{ role: "user", content: userInput }]
 *       loop:
 *         res = await client.messages.create({ model, max_tokens, system: buildSystemPrompt(lights), tools, messages })
 *         push assistant turn (res.content)
 *         if res.stop_reason !== "tool_use": return joined text blocks
 *         for each tool_use block: out = await dispatchTool(name, input, connector, scheduler)
 *           collect { type: "tool_result", tool_use_id, content: out }
 *         push { role: "user", content: toolResults }
 *   - dispatchTool(name, input, connector, scheduler): route light tools to the connector,
 *       and the schedule/list/cancel task tools to the scheduler; return a short text result.
 */

