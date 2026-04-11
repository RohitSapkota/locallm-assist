import {
  createModelClient,
  DEFAULT_MAX_OUTPUT_TOKENS,
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
const DEFAULT_VALIDATION_MODE = "always";
export const VALIDATION_MODES = ["always", "after_tool", "off"] as const;
export type ValidationMode = (typeof VALIDATION_MODES)[number];

function buildSystemPrompt(
  validationCycles: number,
  validationMode: ValidationMode,
) {
  const lines = [
    "You are a tool-using assistant.",
    "Use first-principles reasoning: question assumptions, remove unnecessary steps, then answer directly.",
    "Prefer the smallest truthful answer grounded in the request and tool results.",
    '{"type":"final","text":"Plain-language answer for the user"}',
    '{"type":"tool","tool":"tool_name","arguments":{"required_argument":"value"}}',
    "Reply with JSON only. Do not use markdown fences.",
    "Use a tool only when needed. If the request can be answered without a tool, return a final answer.",
    "Do not invent facts or missing tool arguments. Ask for clarification with a final answer when needed.",
    'After a tool call, you will receive a user message starting with "Tool result:" followed by JSON.',
    "If a tool returns an error, ask for clarification or give the next step.",
    "Tools:",
    ...getToolPromptLines(),
  ];

  if (validationCycles > 0 && validationMode !== "off") {
    lines.splice(6, 0, [
      `The runtime may request up to ${validationCycles} validation pass(es).`,
      "On validation, check the draft against the request and tool results.",
      "If evidence is missing, call a tool. Otherwise return improved final JSON.",
    ].join(" "));
  }

  return lines.join("\n");
}

type ToolExecutor = typeof defaultExecuteToolCall;
export type AgentTraceWriter = (message: string) => void;

export type AgentRunOptions = {
  maxSteps?: number;
  validationCycles?: number;
  validationMode?: ValidationMode;
  contextWindowTokens?: number;
  promptBudgetTokens?: number;
  maxOutputTokens?: number;
  trace?: AgentTraceWriter;
  toolContext?: ToolContext;
  toolExecutor?: ToolExecutor;
};

type ResolvedAgentRunOptions = {
  maxSteps: number;
  validationCycles: number;
  validationMode: ValidationMode;
  contextWindowTokens?: number;
  promptBudgetTokens?: number;
  maxOutputTokens: number;
  trace: AgentTraceWriter;
  toolContext: ToolContext;
  toolExecutor: ToolExecutor;
};

type PromptBudgetOptions = Pick<
  ResolvedAgentRunOptions,
  "contextWindowTokens" | "promptBudgetTokens" | "maxOutputTokens"
>;

type ToolTurn = {
  assistant: TranscriptMessage;
  user: TranscriptMessage;
};

type PendingValidationTurn = ToolTurn | null;

function resolvePositiveIntegerOption(
  name: string,
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${String(value)}. Expected a positive integer.`);
  }

  return value;
}

function estimateTokenCount(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function estimateTranscriptTokens(messages: TranscriptMessage[]) {
  return messages.reduce(
    (total, message) =>
      total + estimateTokenCount(message.role) + estimateTokenCount(message.content) + 2,
    0,
  );
}

function getPromptBudgetError(
  messages: TranscriptMessage[],
  options: PromptBudgetOptions,
  stepNumber: number,
) {
  const promptTokens = estimateTranscriptTokens(messages);

  if (
    options.promptBudgetTokens !== undefined &&
    promptTokens > options.promptBudgetTokens
  ) {
    return `Estimated prompt size ${promptTokens} tokens exceeds prompt budget ${options.promptBudgetTokens} before step ${stepNumber}.`;
  }

  if (
    options.contextWindowTokens !== undefined &&
    promptTokens + options.maxOutputTokens > options.contextWindowTokens
  ) {
    return `Estimated prompt plus output size ${promptTokens + options.maxOutputTokens} tokens exceeds context window ${options.contextWindowTokens} before step ${stepNumber}.`;
  }

  return null;
}

function assertPromptFitsBudget(
  messages: TranscriptMessage[],
  options: PromptBudgetOptions,
  stepNumber: number,
) {
  const error = getPromptBudgetError(messages, options, stepNumber);
  if (error) {
    throw new Error(error);
  }
}

function shouldRunValidationCycle(
  validationMode: ValidationMode,
  remainingValidationCycles: number,
  hasToolEvidence: boolean,
) {
  if (remainingValidationCycles <= 0 || validationMode === "off") {
    return false;
  }

  if (validationMode === "after_tool") {
    return hasToolEvidence;
  }

  return true;
}

function fitsPromptBudget(
  messages: TranscriptMessage[],
  options: PromptBudgetOptions,
) {
  return getPromptBudgetError(messages, options, 0) === null;
}

function flattenToolTurns(toolTurns: ToolTurn[]) {
  return toolTurns.flatMap((turn) => [turn.assistant, turn.user]);
}

function buildMessagesForStep(
  systemPrompt: string,
  input: string,
  completedToolTurns: ToolTurn[],
  pendingValidationTurn: PendingValidationTurn,
  budgetOptions: PromptBudgetOptions,
) {
  const baseMessages: TranscriptMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input },
  ];
  const trailingMessages = pendingValidationTurn
    ? [pendingValidationTurn.assistant, pendingValidationTurn.user]
    : [];
  let selectedTurns: ToolTurn[] = [];

  for (let index = completedToolTurns.length - 1; index >= 0; index--) {
    const toolTurn = completedToolTurns[index];
    if (!toolTurn) {
      continue;
    }

    const candidateTurns = [toolTurn, ...selectedTurns];
    const candidateMessages = [
      ...baseMessages,
      ...flattenToolTurns(candidateTurns),
      ...trailingMessages,
    ];
    if (!fitsPromptBudget(candidateMessages, budgetOptions)) {
      break;
    }

    selectedTurns = candidateTurns;
  }

  return [...baseMessages, ...flattenToolTurns(selectedTurns), ...trailingMessages];
}

function resolveAgentRunOptions(
  options: AgentRunOptions = {},
): ResolvedAgentRunOptions {
  const maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new Error(
      `Invalid maxSteps: ${String(maxSteps)}. Expected a positive integer.`,
    );
  }

  const validationCycles = options.validationCycles ?? DEFAULT_VALIDATION_CYCLES;
  if (!Number.isInteger(validationCycles) || validationCycles < 0) {
    throw new Error(
      `Invalid validationCycles: ${String(validationCycles)}. Expected a non-negative integer.`,
    );
  }

  const validationMode = options.validationMode ?? DEFAULT_VALIDATION_MODE;
  if (!VALIDATION_MODES.includes(validationMode)) {
    throw new Error(
      `Invalid validationMode: ${String(validationMode)}. Expected one of ${VALIDATION_MODES.join(", ")}.`,
    );
  }

  const contextWindowTokens = resolvePositiveIntegerOption(
    "contextWindowTokens",
    options.contextWindowTokens,
  );
  const promptBudgetTokens = resolvePositiveIntegerOption(
    "promptBudgetTokens",
    options.promptBudgetTokens,
  );
  const maxOutputTokens =
    resolvePositiveIntegerOption("maxOutputTokens", options.maxOutputTokens) ??
    DEFAULT_MAX_OUTPUT_TOKENS;

  if (
    contextWindowTokens !== undefined &&
    promptBudgetTokens !== undefined &&
    promptBudgetTokens + maxOutputTokens > contextWindowTokens
  ) {
    throw new Error(
      `Invalid budget settings: promptBudgetTokens (${promptBudgetTokens}) plus maxOutputTokens (${maxOutputTokens}) exceeds contextWindowTokens (${contextWindowTokens}).`,
    );
  }

  return {
    maxSteps,
    validationCycles,
    validationMode,
    contextWindowTokens,
    promptBudgetTokens,
    maxOutputTokens,
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
  Pick<
    AgentRunOptions,
    | "maxSteps"
    | "validationCycles"
    | "validationMode"
    | "contextWindowTokens"
    | "promptBudgetTokens"
    | "maxOutputTokens"
    | "trace"
  >;

export async function runAgent(
  input: string,
  baseUrl: string,
  options: RunAgentOptions = {},
) {
  const {
    maxSteps,
    validationCycles,
    validationMode,
    contextWindowTokens,
    promptBudgetTokens,
    maxOutputTokens,
    maxTokens,
    trace,
    ...modelOptions
  } = options;
  const resolvedMaxOutputTokens = maxOutputTokens ?? maxTokens;

  return runAgentWithModel(
    input,
    createModelClient(baseUrl, {
      ...modelOptions,
      ...(resolvedMaxOutputTokens !== undefined
        ? { maxOutputTokens: resolvedMaxOutputTokens }
        : {}),
    }),
    {
      maxSteps,
      validationCycles,
      validationMode,
      contextWindowTokens,
      promptBudgetTokens,
      maxOutputTokens: resolvedMaxOutputTokens,
      trace,
    },
  );
}

export async function runAgentWithModel(
  input: string,
  model: ModelClient,
  options: AgentRunOptions = {},
) {
  const {
    maxSteps,
    validationCycles,
    validationMode,
    contextWindowTokens,
    promptBudgetTokens,
    maxOutputTokens,
    trace,
    toolContext,
    toolExecutor,
  } = resolveAgentRunOptions(options);
  const systemPrompt = buildSystemPrompt(validationCycles, validationMode);
  const budgetOptions: PromptBudgetOptions = {
    contextWindowTokens,
    promptBudgetTokens,
    maxOutputTokens,
  };
  const completedToolTurns: ToolTurn[] = [];
  let pendingValidationTurn: PendingValidationTurn = null;
  let lastResult: ModelResult | null = null;
  let remainingValidationCycles = validationCycles;
  let hasToolEvidence = false;

  const startDetails = [
    `maxSteps=${maxSteps}`,
    `validationMode=${validationMode}`,
    `validationCycles=${validationCycles}`,
    `maxOutputTokens=${maxOutputTokens}`,
  ];
  if (contextWindowTokens !== undefined) {
    startDetails.push(`contextWindowTokens=${contextWindowTokens}`);
  }
  if (promptBudgetTokens !== undefined) {
    startDetails.push(`promptBudgetTokens=${promptBudgetTokens}`);
  }
  trace(`Starting agent run with ${startDetails.join(", ")}.`);

  for (let step = 0; step < maxSteps; step++) {
    const stepNumber = step + 1;
    trace(`Step ${stepNumber}/${maxSteps}: requesting model response.`);
    const messages = buildMessagesForStep(
      systemPrompt,
      input,
      completedToolTurns,
      pendingValidationTurn,
      budgetOptions,
    );
    assertPromptFitsBudget(messages, budgetOptions, stepNumber);
    const result = await model(messages);
    lastResult = result;
    pendingValidationTurn = null;

    if (result.type === "final") {
      if (
        shouldRunValidationCycle(
          validationMode,
          remainingValidationCycles,
          hasToolEvidence,
        )
      ) {
        const cycleNumber = validationCycles - remainingValidationCycles + 1;
        trace(
          `Step ${stepNumber}/${maxSteps}: draft answer produced. Starting validation cycle ${cycleNumber}/${validationCycles}.`,
        );
        pendingValidationTurn = {
          assistant: {
            role: "assistant",
            content: JSON.stringify(result),
          },
          user: createValidationMessage(
            cycleNumber,
            validationCycles,
            result.text,
          ),
        };
        remainingValidationCycles -= 1;
        continue;
      }

      trace(`Step ${stepNumber}/${maxSteps}: final answer accepted.`);
      return result.text;
    }

    trace(
      `Step ${stepNumber}/${maxSteps}: calling tool ${result.tool} with arguments ${JSON.stringify(result.arguments)}.`,
    );

    const toolOutput = await toolExecutor(result, toolContext);
    if (toolOutput.ok) {
      trace(`Step ${stepNumber}/${maxSteps}: tool ${result.tool} succeeded.`);
    } else {
      trace(
        `Step ${stepNumber}/${maxSteps}: tool ${result.tool} failed [${toolOutput.code}]: ${toolOutput.error}`,
      );
    }
    remainingValidationCycles = validationCycles;
    hasToolEvidence = true;
    completedToolTurns.push({
      assistant: {
        role: "assistant",
        content: JSON.stringify(result),
      },
      user: createToolResultMessage(toolOutput),
    });
    if (validationMode !== "off" && validationCycles > 0) {
      trace(
        `Step ${stepNumber}/${maxSteps}: validation cycle reset after new tool evidence.`,
      );
    }
  }

  trace(`Stopped after ${maxSteps} step(s) without an accepted final answer.`);
  throw new Error(
    `Max steps exceeded: ${maxSteps}. Last result: ${lastResult ? JSON.stringify(lastResult) : "none"}`,
  );
}
