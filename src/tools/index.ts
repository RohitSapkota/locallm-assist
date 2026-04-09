import { createToolRegistry } from "./registry";
import { getWeatherTool } from "./weather/tool";

export const toolRegistry = createToolRegistry([getWeatherTool]);

export function getToolPromptLines() {
  return toolRegistry.getPromptLines();
}

export function executeToolCall(
  call: { tool: string; arguments: Record<string, unknown> },
  context: Parameters<typeof toolRegistry.execute>[1],
) {
  return toolRegistry.execute(call, context);
}
