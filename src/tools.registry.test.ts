import { expect, test } from "bun:test";
import { z } from "zod";

import {
  createToolContext,
  ToolError,
  type ToolDefinition,
} from "./tools/base";
import { createToolRegistry } from "./tools/registry";

const echoTool = {
  name: "echo",
  description: "Echo text back to the user",
  whenToUse: "Use when the user explicitly asks to repeat or echo text.",
  exampleArgs: {
    text: "hello",
  },
  schema: z.object({
    text: z.string(),
  }),
  run: async ({ text }) => ({
    echoed: text,
  }),
} satisfies ToolDefinition<{ text: string }, { echoed: string }>;

test("registry rejects duplicate tool names", () => {
  expect(() => createToolRegistry([echoTool, echoTool])).toThrow(
    "Duplicate tool name: echo",
  );
});

test("registry exposes prompt metadata for each tool", () => {
  const registry = createToolRegistry([echoTool]);
  const lines = registry.getPromptLines();

  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("- echo: Echo text back to the user.");
  expect(lines[0]).toContain(
    "Use when: Use when the user explicitly asks to repeat or echo text.",
  );
  expect(lines[0]).toContain("Arguments: text (required string).");
  expect(lines[0]).toContain('Example arguments: {"text":"hello"}');
});

test("registry returns structured failures for unknown tools", async () => {
  const registry = createToolRegistry([echoTool]);

  await expect(
    registry.execute(
      {
        tool: "missing",
        arguments: {},
      },
      createToolContext(),
    ),
  ).resolves.toEqual({
    ok: false,
    tool: "missing",
    code: "tool_not_found",
    error: "Unknown tool: missing",
  });
});

test("registry returns validation errors for invalid arguments", async () => {
  const registry = createToolRegistry([echoTool]);

  await expect(
    registry.execute(
      {
        tool: "echo",
        arguments: {},
      },
      createToolContext(),
    ),
  ).resolves.toEqual({
    ok: false,
    tool: "echo",
    code: "validation_error",
    error: "Invalid input: expected string, received undefined",
  });
});

test("registry preserves tool error codes", async () => {
  const clarificationTool = {
    ...echoTool,
    name: "clarify",
    schema: z.object({ text: z.string() }),
    run: async () => {
      throw new ToolError("clarification_required", "Need more detail");
    },
  } satisfies ToolDefinition<{ text: string }, { echoed: string }>;
  const registry = createToolRegistry([clarificationTool]);

  await expect(
    registry.execute(
      {
        tool: "clarify",
        arguments: { text: "hello" },
      },
      createToolContext(),
    ),
  ).resolves.toEqual({
    ok: false,
    tool: "clarify",
    code: "clarification_required",
    error: "Need more detail",
  });
});

test("registry maps unexpected errors to internal failures", async () => {
  const failingTool = {
    ...echoTool,
    name: "explode",
    schema: z.object({ text: z.string() }),
    run: async () => {
      throw new Error("boom");
    },
  } satisfies ToolDefinition<{ text: string }, { echoed: string }>;
  const registry = createToolRegistry([failingTool]);

  await expect(
    registry.execute(
      {
        tool: "explode",
        arguments: { text: "hello" },
      },
      createToolContext(),
    ),
  ).resolves.toEqual({
    ok: false,
    tool: "explode",
    code: "internal_error",
    error: "boom",
  });
});
