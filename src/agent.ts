import {
  createModelClient,
  type ModelClient,
  type ModelClientOptions,
  type ModelResult,
  type TranscriptMessage,
} from "./llm";
import {
  createToolContext,
  type ToolContext,
  type ToolExecutionResult,
} from "./tools/base";
import { executeToolCall as defaultExecuteToolCall, getToolPromptLines } from "./tools";

const MAX_AGENT_STEPS = 8;

function buildSystemPrompt() {
  return [
    "You are a tool-using assistant.",
    "Default operating standard: use first-principles reasoning and this 5-step order on every task.",
    "1. Question every requirement and separate facts from assumptions.",
    "2. Delete unnecessary parts, steps, and assumptions before improving anything.",
    "3. Simplify and optimize only what remains.",
    "4. Accelerate feedback loops and cycle time after the design is right.",
    "5. Automate only after the process is stable and worth repeating.",
    "Prefer the smallest truthful solution, and call out weak requirements or hidden assumptions when they materially affect the answer.",
    "Use a tool only when the user's request actually requires that tool.",
    "If the request can be answered without a tool, respond with a final answer.",
    "Do not invent missing tool arguments or facts; ask for clarification when required data is missing.",
    "Available tools:",
    ...getToolPromptLines(),
    'After you request a tool, you will receive a user message that starts with "Tool result:" followed by JSON.',
    "Respond ONLY with valid JSON using one of these shapes.",
    '{"type":"final","text":"Plain-language answer for the user"}',
    '{"type":"tool","tool":"tool_name","arguments":{"required_argument":"value"}}',
    "Do not use markdown fences.",
    "If a tool result includes an error, use it to ask the user a clarifying question or give the best next step.",
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

type ToolExecutor = typeof defaultExecuteToolCall;

export type AgentRunOptions = {
  maxSteps?: number;
  toolContext?: ToolContext;
  toolExecutor?: ToolExecutor;
};

function resolveAgentRunOptions(
  options: AgentRunOptions = {},
): Required<AgentRunOptions> {
  return {
    maxSteps: options.maxSteps ?? MAX_AGENT_STEPS,
    toolContext: options.toolContext ?? createToolContext(),
    toolExecutor: options.toolExecutor ?? defaultExecuteToolCall,
  };
}

function createToolResultMessage(
  toolOutput: ToolExecutionResult,
): TranscriptMessage {
  return {
    role: "user",
    content: [
      "Tool result:",
      JSON.stringify(toolOutput),
      "Use this result to continue. Respond ONLY with valid JSON.",
    ].join("\n"),
  };
}

export async function runAgent(
  input: string,
  baseUrl: string,
  modelOptions: ModelClientOptions = {},
) {
  return runAgentWithModel(input, createModelClient(baseUrl, modelOptions));
}

export async function runAgentWithModel(
  input: string,
  model: ModelClient,
  options: AgentRunOptions = {},
) {
  const { maxSteps, toolContext, toolExecutor } = resolveAgentRunOptions(options);
  const messages: TranscriptMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ];
  let lastResult: ModelResult | null = null;

  for (let step = 0; step < maxSteps; step++) {
    const result = await model(messages);
    lastResult = result;

    if (result.type === "final") {
      return result.text;
    }

    messages.push({
      role: "assistant",
      content: JSON.stringify(result),
    });

    const toolOutput = await toolExecutor(result, toolContext);

    messages.push(createToolResultMessage(toolOutput));
  }

  throw new Error(
    `Max steps exceeded: ${maxSteps}. Last result: ${lastResult ? JSON.stringify(lastResult) : "none"}`,
  );
}
