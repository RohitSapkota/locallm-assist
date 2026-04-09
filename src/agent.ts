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

const MAX_AGENT_STEPS = 12;
const DEFAULT_VALIDATION_CYCLES = 2;

function buildSystemPrompt(validationCycles: number) {
  const lines = [
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
  ];

  if (validationCycles > 0) {
    lines.splice(
      10,
      0,
      `The runtime will enforce ${validationCycles} validation cycle(s) before it accepts any final answer.`,
      "Use each validation cycle to aggressively check for unsupported claims, contradictions, stale assumptions, missing edge cases, and calculation mistakes.",
      "If a validation cycle shows missing evidence, request another tool instead of forcing a final answer.",
    );
  }

  return lines.join("\n");
}

type ToolExecutor = typeof defaultExecuteToolCall;
export type AgentTraceWriter = (message: string) => void;

export type AgentRunOptions = {
  maxSteps?: number;
  validationCycles?: number;
  trace?: AgentTraceWriter;
  toolContext?: ToolContext;
  toolExecutor?: ToolExecutor;
};

function resolveAgentRunOptions(
  options: AgentRunOptions = {},
): Required<AgentRunOptions> {
  const validationCycles = options.validationCycles ?? DEFAULT_VALIDATION_CYCLES;
  if (!Number.isInteger(validationCycles) || validationCycles < 0) {
    throw new Error(
      `Invalid validationCycles: ${String(validationCycles)}. Expected a non-negative integer.`,
    );
  }

  return {
    maxSteps: options.maxSteps ?? MAX_AGENT_STEPS,
    validationCycles,
    trace: options.trace ?? (() => undefined),
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

function createValidationMessage(
  cycleNumber: number,
  totalCycles: number,
  draftAnswer: string,
): TranscriptMessage {
  return {
    role: "user",
    content: [
      `Validation cycle ${cycleNumber} of ${totalCycles}.`,
      "Review the latest draft answer against the original request and every tool result so far.",
      "Look for unsupported claims, contradictions, stale data, hidden assumptions, and calculation mistakes.",
      `Draft answer to review: ${JSON.stringify(draftAnswer)}`,
      "If more evidence or checking is required, respond with a tool call JSON.",
      "If the answer is fully supported, respond with an improved final JSON answer.",
      "Respond ONLY with valid JSON.",
    ].join("\n"),
  };
}

export type RunAgentOptions = ModelClientOptions &
  Pick<AgentRunOptions, "maxSteps" | "validationCycles" | "trace">;

export async function runAgent(
  input: string,
  baseUrl: string,
  options: RunAgentOptions = {},
) {
  const { maxSteps, validationCycles, trace, ...modelOptions } = options;

  return runAgentWithModel(input, createModelClient(baseUrl, modelOptions), {
    maxSteps,
    validationCycles,
    trace,
  });
}

export async function runAgentWithModel(
  input: string,
  model: ModelClient,
  options: AgentRunOptions = {},
) {
  const { maxSteps, validationCycles, trace, toolContext, toolExecutor } =
    resolveAgentRunOptions(options);
  const messages: TranscriptMessage[] = [
    { role: "system", content: buildSystemPrompt(validationCycles) },
    { role: "user", content: input },
  ];
  let lastResult: ModelResult | null = null;
  let remainingValidationCycles = validationCycles;

  trace(
    `Starting agent run with maxSteps=${maxSteps} and validationCycles=${validationCycles}.`,
  );

  for (let step = 0; step < maxSteps; step++) {
    const stepNumber = step + 1;
    trace(`Step ${stepNumber}/${maxSteps}: requesting model response.`);
    const result = await model(messages);
    lastResult = result;

    if (result.type === "final") {
      if (remainingValidationCycles > 0) {
        const cycleNumber = validationCycles - remainingValidationCycles + 1;
        trace(
          `Step ${stepNumber}/${maxSteps}: draft answer produced. Starting validation cycle ${cycleNumber}/${validationCycles}.`,
        );
        messages.push({
          role: "assistant",
          content: JSON.stringify(result),
        });
        messages.push(
          createValidationMessage(
            cycleNumber,
            validationCycles,
            result.text,
          ),
        );
        remainingValidationCycles -= 1;
        continue;
      }

      trace(`Step ${stepNumber}/${maxSteps}: final answer accepted.`);
      return result.text;
    }

    trace(
      `Step ${stepNumber}/${maxSteps}: calling tool ${result.tool} with arguments ${JSON.stringify(result.arguments)}.`,
    );
    messages.push({
      role: "assistant",
      content: JSON.stringify(result),
    });

    const toolOutput = await toolExecutor(result, toolContext);
    if (toolOutput.ok) {
      trace(`Step ${stepNumber}/${maxSteps}: tool ${result.tool} succeeded.`);
    } else {
      trace(
        `Step ${stepNumber}/${maxSteps}: tool ${result.tool} failed [${toolOutput.code}]: ${toolOutput.error}`,
      );
    }
    remainingValidationCycles = validationCycles;
    if (validationCycles > 0) {
      trace(
        `Step ${stepNumber}/${maxSteps}: validation cycle reset after new tool evidence.`,
      );
    }

    messages.push(createToolResultMessage(toolOutput));
  }

  trace(`Stopped after ${maxSteps} step(s) without an accepted final answer.`);
  throw new Error(
    `Max steps exceeded: ${maxSteps}. Last result: ${lastResult ? JSON.stringify(lastResult) : "none"}`,
  );
}
