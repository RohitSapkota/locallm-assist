import {
  type AnyToolDefinition,
  createToolSuccess,
  toToolFailure,
  type ToolContext,
  type ToolExecutionResult,
} from "./base";
import { z } from "zod";

export type ToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
};

function describeArgumentType(schema: z.ZodTypeAny) {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return describeArgumentType(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodDefault) {
    return describeArgumentType(schema.removeDefault() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodString) {
    return "string";
  }

  if (schema instanceof z.ZodNumber) {
    return "number";
  }

  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }

  if (schema instanceof z.ZodEnum) {
    return `one of ${schema.options.join(", ")}`;
  }

  return "value";
}

function describeArguments(schema: AnyToolDefinition["schema"]) {
  if (!(schema instanceof z.ZodObject)) {
    return "Arguments must match the registered schema.";
  }

  const entries = Object.entries(schema.shape);
  if (entries.length === 0) {
    return "No arguments.";
  }

  return `Arguments: ${entries
    .map(
      ([name, value]) =>
        `${name} (${value.isOptional() ? "optional" : "required"} ${describeArgumentType(value)})`,
    )
    .join(", ")}`;
}

function trimPromptSentence(value: string) {
  return value
    .trim()
    .replace(/^Use when\s+/i, "")
    .replace(/\.$/, "");
}

export class ToolRegistry {
  private readonly definitions: readonly AnyToolDefinition[];
  private readonly definitionMap: ReadonlyMap<string, AnyToolDefinition>;

  constructor(definitions: readonly AnyToolDefinition[]) {
    const definitionMap = new Map<string, AnyToolDefinition>();

    for (const definition of definitions) {
      if (definitionMap.has(definition.name)) {
        throw new Error(`Duplicate tool name: ${definition.name}`);
      }

      definitionMap.set(definition.name, definition);
    }

    this.definitions = definitions;
    this.definitionMap = definitionMap;
  }

  getPromptLines() {
    return this.definitions.map(
      (definition) => {
        const argumentDescription = describeArguments(definition.schema);

        return `- ${definition.name}: ${trimPromptSentence(definition.description)}. Use when: ${trimPromptSentence(definition.whenToUse)}. ${argumentDescription}. Example arguments: ${JSON.stringify(definition.exampleArgs)}`;
      },
    );
  }

  findTool(name: string) {
    return this.definitionMap.get(name);
  }

  async execute(
    call: ToolCall,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const definition = this.findTool(call.tool);
    if (!definition) {
      return {
        ok: false,
        tool: call.tool,
        code: "tool_not_found",
        error: `Unknown tool: ${call.tool}`,
      };
    }

    try {
      const args = definition.schema.parse(call.arguments);
      const result = await definition.run(args, context);
      return createToolSuccess(call.tool, result);
    } catch (error) {
      return toToolFailure(call.tool, error);
    }
  }
}

export function createToolRegistry(definitions: readonly AnyToolDefinition[]) {
  return new ToolRegistry(definitions);
}
