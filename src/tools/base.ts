import { z } from "zod";

export type ToolArguments = Record<string, unknown>;

export type ToolContext = {
  fetch: typeof fetch;
};

export type ToolDefinition<
  Args extends ToolArguments = ToolArguments,
  Result = unknown,
> = {
  name: string;
  description: string;
  whenToUse: string;
  exampleArgs: Args;
  schema: z.ZodType<Args>;
  run: (args: Args, context: ToolContext) => Promise<Result>;
};

export type AnyToolDefinition = ToolDefinition<any, any>;

export type ToolFailureCode =
  | "validation_error"
  | "clarification_required"
  | "external_service_error"
  | "internal_error"
  | "tool_not_found";

export type ToolSuccess<Result = unknown> = {
  ok: true;
  tool: string;
  result: Result;
};

export type ToolFailure = {
  ok: false;
  tool: string;
  code: ToolFailureCode;
  error: string;
};

export type ToolExecutionResult<Result = unknown> =
  | ToolSuccess<Result>
  | ToolFailure;

export class ToolError extends Error {
  readonly code: ToolFailureCode;

  constructor(code: ToolFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ToolError";
  }
}

export function createToolContext(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    fetch: globalThis.fetch,
    ...overrides,
  };
}

export function createToolSuccess<Result>(
  tool: string,
  result: Result,
): ToolSuccess<Result> {
  return {
    ok: true,
    tool,
    result,
  };
}

export function toToolFailure(tool: string, error: unknown): ToolFailure {
  if (error instanceof ToolError) {
    return {
      ok: false,
      tool,
      code: error.code,
      error: error.message,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      ok: false,
      tool,
      code: "validation_error",
      error:
        error.issues.map((issue) => issue.message).join("; ") ||
        "Invalid tool arguments",
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      tool,
      code: "internal_error",
      error: error.message,
    };
  }

  return {
    ok: false,
    tool,
    code: "internal_error",
    error: String(error),
  };
}
