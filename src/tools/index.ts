import { createToolRegistry } from "./registry";
import { getDateTimeTool } from "./datetime/tool";
import { searchWebTool } from "./web-search/tool";
import { getWeatherTool } from "./weather/tool";

export const toolRegistry = createToolRegistry([
  getDateTimeTool,
  getWeatherTool,
  searchWebTool,
]);

export function getToolPromptLines() {
  return toolRegistry.getPromptLines();
}

export function executeToolCall(
  call: { tool: string; arguments: Record<string, unknown> },
  context: Parameters<typeof toolRegistry.execute>[1],
) {
  return toolRegistry.execute(call, context);
}
