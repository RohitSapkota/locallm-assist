import { expect, test } from "bun:test";

import { runAgentWithModel, type AgentRunOptions } from "./agent";
import type { ModelClient, TranscriptMessage } from "./llm";
import type { ToolExecutionResult } from "./tools/base";

test("returns a direct final answer without using a tool", async () => {
  const model: ModelClient = async (messages) => {
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain("Question every requirement");
    expect(messages[0]?.content).toContain("Delete unnecessary parts, steps, and assumptions");
    expect(messages[0]?.content).toContain("Automate only after the process is stable and worth repeating");
    expect(messages[0]?.content).toContain(
      "Use a tool only when the user's request actually requires that tool",
    );
    expect(messages[0]?.content).toContain(
      "Do not invent missing tool arguments or facts",
    );
    expect(messages[0]?.content).toContain('"type":"final"');
    expect(messages[0]?.content).toContain('"type":"tool"');
    expect(messages[0]?.content).toContain("Use when:");
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });

    return { type: "final", text: "Hi there." };
  };

  await expect(runAgentWithModel("Hello", model)).resolves.toBe("Hi there.");
});

test("supports multiple tool turns before the final answer", async () => {
  const calls: TranscriptMessage[][] = [];
  const toolResults = new Map<string, ToolExecutionResult>([
    [
      JSON.stringify({ city: "Perth", country: "Australia" }),
      {
        ok: true,
        tool: "get_weather",
        result: {
          city: "Perth",
          region: "Western Australia",
          country: "Australia",
          timezone: "Australia/Perth",
          forecast: "Clear sky",
          temperatureC: 25,
          apparentTemperatureC: 27,
          windSpeedKmh: 14,
        },
      },
    ],
    [
      JSON.stringify({ city: "Berlin", country: "Germany" }),
      {
        ok: true,
        tool: "get_weather",
        result: {
          city: "Berlin",
          region: "Berlin",
          country: "Germany",
          timezone: "Europe/Berlin",
          forecast: "Rain",
          temperatureC: 13.2,
          apparentTemperatureC: 11.8,
          windSpeedKmh: 18.4,
        },
      },
    ],
  ]);
  const toolExecutor: NonNullable<AgentRunOptions["toolExecutor"]> = async (
    call,
  ) => {
    const result = toolResults.get(JSON.stringify(call.arguments));
    if (!result) {
      throw new Error(`Unexpected tool call: ${JSON.stringify(call)}`);
    }

    return result;
  };
  const model: ModelClient = async (messages) => {
    calls.push(messages.map((message) => ({ ...message })));

    if (calls.length === 1) {
      return {
        type: "tool",
        tool: "get_weather",
        arguments: { city: "Perth", country: "Australia" },
      };
    }

    if (calls.length === 2) {
      return {
        type: "tool",
        tool: "get_weather",
        arguments: { city: "Berlin", country: "Germany" },
      };
    }

    return { type: "final", text: "Perth is clear and Berlin is rainy." };
  };

  await expect(
    runAgentWithModel("What's the weather in Perth?", model, { toolExecutor }),
  ).resolves.toBe("Perth is clear and Berlin is rainy.");

  expect(calls).toHaveLength(3);
  expect(calls[1]?.[2]).toEqual({
    role: "assistant",
    content: JSON.stringify({
      type: "tool",
      tool: "get_weather",
      arguments: { city: "Perth", country: "Australia" },
    }),
  });
  expect(calls[1]?.[3]).toEqual({
    role: "user",
    content: [
      "Tool result:",
      JSON.stringify(toolResults.get(JSON.stringify({ city: "Perth", country: "Australia" }))),
      "Use this result to continue. Respond ONLY with valid JSON.",
    ].join("\n"),
  });
  expect(calls[2]?.[4]).toEqual({
    role: "assistant",
    content: JSON.stringify({
      type: "tool",
      tool: "get_weather",
      arguments: { city: "Berlin", country: "Germany" },
    }),
  });
});

test("passes tool errors back to the model as structured tool output", async () => {
  const toolExecutor: NonNullable<AgentRunOptions["toolExecutor"]> = async () => ({
    ok: false as const,
    tool: "get_weather",
    code: "clarification_required" as const,
    error:
      'City lookup is ambiguous for "Perth". Be more specific with region or country. Matches: Perth, Western Australia, Australia | Perth, Scotland, United Kingdom',
  });
  const model: ModelClient = async (messages) => {
    if (messages.length === 2) {
      return {
        type: "tool",
        tool: "get_weather",
        arguments: { city: "Perth" },
      };
    }

    expect(messages[3]).toEqual({
      role: "user",
      content: [
        "Tool result:",
        JSON.stringify({
          ok: false,
          tool: "get_weather",
          code: "clarification_required",
          error:
            'City lookup is ambiguous for "Perth". Be more specific with region or country. Matches: Perth, Western Australia, Australia | Perth, Scotland, United Kingdom',
        }),
        "Use this result to continue. Respond ONLY with valid JSON.",
      ].join("\n"),
    });

    return {
      type: "final",
      text: "Please specify which Perth you mean, for example Perth, Australia or Perth, Scotland.",
    };
  };

  await expect(
    runAgentWithModel("What's the weather in Perth?", model, { toolExecutor }),
  ).resolves.toBe(
    "Please specify which Perth you mean, for example Perth, Australia or Perth, Scotland.",
  );
});

test("passes unknown tool requests back to the model instead of crashing", async () => {
  const model: ModelClient = async (messages) => {
    if (messages.length === 2) {
      return {
        type: "tool",
        tool: "get_news",
        arguments: { topic: "weather" },
      };
    }

    expect(messages[3]).toEqual({
      role: "user",
      content: [
        "Tool result:",
        JSON.stringify({
          ok: false,
          tool: "get_news",
          code: "tool_not_found",
          error: "Unknown tool: get_news",
        }),
        "Use this result to continue. Respond ONLY with valid JSON.",
      ].join("\n"),
    });

    return {
      type: "final",
      text: "I do not have a get_news tool available.",
    };
  };

  await expect(runAgentWithModel("Latest weather headlines?", model)).resolves.toBe(
    "I do not have a get_news tool available.",
  );
});

test("stops after the configured max step count", async () => {
  const model: ModelClient = async () => ({
    type: "tool",
    tool: "get_news",
    arguments: {},
  });

  await expect(
    runAgentWithModel("Loop forever", model, { maxSteps: 2 }),
  ).rejects.toThrow("Max steps exceeded: 2");
});
