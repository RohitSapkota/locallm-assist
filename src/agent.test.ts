import { expect, test } from "bun:test";

import { runAgentWithModel, type AgentRunOptions } from "./agent";
import type { ModelClient, TranscriptMessage } from "./llm";
import type { ToolExecutionResult } from "./tools/base";

test("returns a direct final answer without using a tool", async () => {
  const model: ModelClient = async (messages) => {
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain("Use first-principles reasoning");
    expect(messages[0]?.content).toContain(
      "Prefer the smallest truthful answer grounded in the request and tool results.",
    );
    expect(messages[0]?.content).toContain(
      "Use a tool only when needed.",
    );
    expect(messages[0]?.content).toContain(
      "Do not invent facts or missing tool arguments.",
    );
    expect(messages[0]?.content).toContain('"type":"final"');
    expect(messages[0]?.content).toContain('"type":"tool"');
    expect(messages[0]?.content).toContain("Tools:");
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });

    return { type: "final", text: "Hi there." };
  };

  await expect(
    runAgentWithModel("Hello", model, { validationCycles: 0 }),
  ).resolves.toBe("Hi there.");
});

test("after_tool validation mode accepts direct final answers without extra turns", async () => {
  let callCount = 0;
  const model: ModelClient = async (messages) => {
    callCount += 1;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain(
      "The runtime may request up to 1 validation pass(es).",
    );

    return { type: "final", text: "Hi there." };
  };

  await expect(
    runAgentWithModel("Hello", model, {
      validationCycles: 1,
      validationMode: "after_tool",
    }),
  ).resolves.toBe("Hi there.");

  expect(callCount).toBe(1);
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
    runAgentWithModel("What's the weather in Perth?", model, {
      toolExecutor,
      validationCycles: 0,
    }),
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
  expect(calls[2]?.[5]).toEqual({
    role: "user",
    content: [
      "Tool result:",
      JSON.stringify(toolResults.get(JSON.stringify({ city: "Berlin", country: "Germany" }))),
      "Use this result to continue. Respond ONLY with valid JSON.",
    ].join("\n"),
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
    runAgentWithModel("What's the weather in Perth?", model, {
      toolExecutor,
      validationCycles: 0,
    }),
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

  await expect(
    runAgentWithModel("Latest weather headlines?", model, {
      validationCycles: 0,
    }),
  ).resolves.toBe("I do not have a get_news tool available.");
});

test("stops after the configured max step count", async () => {
  const model: ModelClient = async () => ({
    type: "tool",
    tool: "get_news",
    arguments: {},
  });

  await expect(
    runAgentWithModel("Loop forever", model, { maxSteps: 2, validationCycles: 0 }),
  ).rejects.toThrow("Max steps exceeded: 2");
});

test("performs multiple validation cycles before accepting a final answer", async () => {
  const calls: TranscriptMessage[][] = [];
  const model: ModelClient = async (messages) => {
    calls.push(messages.map((message) => ({ ...message })));

    if (calls.length === 1) {
      expect(messages[0]?.content).toContain(
        "The runtime may request up to 2 validation pass(es).",
      );
      return { type: "final", text: "Initial answer." };
    }

    if (calls.length === 2) {
      expect(messages[2]).toEqual({
        role: "assistant",
        content: JSON.stringify({
          type: "final",
          text: "Initial answer.",
        }),
      });
      expect(messages[3]).toEqual({
        role: "user",
        content: [
          "Validation cycle 1 of 2.",
          "Review the latest draft answer against the original request and every tool result so far.",
          "Look for unsupported claims, contradictions, stale data, hidden assumptions, and calculation mistakes.",
          'Draft answer to review: "Initial answer."',
          "If more evidence or checking is required, respond with a tool call JSON.",
          "If the answer is fully supported, respond with an improved final JSON answer.",
          "Respond ONLY with valid JSON.",
        ].join("\n"),
      });
      return { type: "final", text: "Revised answer." };
    }

    expect(messages[2]).toEqual({
      role: "assistant",
      content: JSON.stringify({
        type: "final",
        text: "Revised answer.",
      }),
    });
    expect(messages[3]).toEqual({
      role: "user",
      content: [
        "Validation cycle 2 of 2.",
        "Review the latest draft answer against the original request and every tool result so far.",
        "Look for unsupported claims, contradictions, stale data, hidden assumptions, and calculation mistakes.",
        'Draft answer to review: "Revised answer."',
        "If more evidence or checking is required, respond with a tool call JSON.",
        "If the answer is fully supported, respond with an improved final JSON answer.",
        "Respond ONLY with valid JSON.",
      ].join("\n"),
    });

    return { type: "final", text: "Best checked answer." };
  };

  await expect(runAgentWithModel("Hello", model)).resolves.toBe(
    "Best checked answer.",
  );
  expect(calls).toHaveLength(3);
});

test("restarts validation cycles after a tool call adds new evidence", async () => {
  const calls: TranscriptMessage[][] = [];
  const toolExecutor: NonNullable<AgentRunOptions["toolExecutor"]> = async () => ({
    ok: true as const,
    tool: "search_web",
    result: {
      provider: "duckduckgo",
      query: "latest result",
      results: [
        {
          title: "Checked source",
          url: "https://example.com/source",
          snippet: "Validated data",
        },
      ],
    },
  });
  const model: ModelClient = async (messages) => {
    calls.push(messages.map((message) => ({ ...message })));

    if (calls.length === 1) {
      return { type: "final", text: "Draft without enough evidence." };
    }

    if (calls.length === 2) {
      expect(messages[3]?.content).toContain("Validation cycle 1 of 1.");
      return {
        type: "tool",
        tool: "search_web",
        arguments: { query: "latest result" },
      };
    }

    if (calls.length === 3) {
      expect(messages[3]).toEqual({
        role: "user",
        content: [
          "Tool result:",
          JSON.stringify({
            ok: true,
            tool: "search_web",
            result: {
              provider: "duckduckgo",
              query: "latest result",
              results: [
                {
                  title: "Checked source",
                  url: "https://example.com/source",
                  snippet: "Validated data",
                },
              ],
            },
          }),
          "Use this result to continue. Respond ONLY with valid JSON.",
        ].join("\n"),
      });
      expect(messages[2]).toEqual({
        role: "assistant",
        content: JSON.stringify({
          type: "tool",
          tool: "search_web",
          arguments: { query: "latest result" },
        }),
      });
      return { type: "final", text: "Answer with evidence." };
    }

    expect(messages[2]).toEqual({
      role: "assistant",
      content: JSON.stringify({
        type: "tool",
        tool: "search_web",
        arguments: { query: "latest result" },
      }),
    });
    expect(messages[3]?.content).toContain('"query":"latest result"');
    expect(messages[5]?.content).toContain("Validation cycle 1 of 1.");
    return { type: "final", text: "Best checked answer." };
  };

  await expect(
    runAgentWithModel("Find the latest result", model, {
      toolExecutor,
      validationCycles: 1,
    }),
  ).resolves.toBe("Best checked answer.");

  expect(calls).toHaveLength(4);
});

test("emits trace lines for model turns, validation, and tool execution", async () => {
  const trace: string[] = [];
  const toolExecutor: NonNullable<AgentRunOptions["toolExecutor"]> = async () => ({
    ok: true as const,
    tool: "search_web",
    result: {
      provider: "duckduckgo",
      query: "perth time",
      results: [
        {
          title: "Perth time",
          url: "https://example.com/perth-time",
          snippet: "UTC+8",
        },
      ],
    },
  });
  let callCount = 0;
  const model: ModelClient = async () => {
    callCount += 1;

    if (callCount === 1) {
      return { type: "final", text: "Draft answer." };
    }

    if (callCount === 2) {
      return {
        type: "tool",
        tool: "search_web",
        arguments: { query: "perth time" },
      };
    }

    if (callCount === 3) {
      return { type: "final", text: "Revised answer." };
    }

    return { type: "final", text: "Best checked answer." };
  };

  await expect(
    runAgentWithModel("What time is it in Perth?", model, {
      toolExecutor,
      validationCycles: 1,
      trace: (message) => trace.push(message),
    }),
  ).resolves.toBe("Best checked answer.");

  expect(trace).toEqual([
    "Starting agent run with maxSteps=12, validationMode=always, validationCycles=1, maxOutputTokens=400.",
    "Step 1/12: requesting model response.",
    "Step 1/12: draft answer produced. Starting validation cycle 1/1.",
    "Step 2/12: requesting model response.",
    'Step 2/12: calling tool search_web with arguments {"query":"perth time"}.',
    "Step 2/12: tool search_web succeeded.",
    "Step 2/12: validation cycle reset after new tool evidence.",
    "Step 3/12: requesting model response.",
    "Step 3/12: draft answer produced. Starting validation cycle 1/1.",
    "Step 4/12: requesting model response.",
    "Step 4/12: final answer accepted.",
  ]);
});

test("fails before calling the model when the estimated prompt exceeds the prompt budget", async () => {
  let called = false;
  const model: ModelClient = async () => {
    called = true;
    return { type: "final", text: "Hi" };
  };

  await expect(
    runAgentWithModel("Hello", model, {
      validationCycles: 0,
      promptBudgetTokens: 1,
    }),
  ).rejects.toThrow("Estimated prompt size");

  expect(called).toBe(false);
});

test("rejects invalid validation cycle counts", async () => {
  const model: ModelClient = async () => ({ type: "final", text: "Hi" });

  await expect(
    runAgentWithModel("Hello", model, { validationCycles: -1 }),
  ).rejects.toThrow(
    "Invalid validationCycles: -1. Expected a non-negative integer.",
  );
});

test("rejects invalid validation modes", async () => {
  const model: ModelClient = async () => ({ type: "final", text: "Hi" });

  await expect(
    runAgentWithModel("Hello", model, {
      validationMode: "sometimes" as never,
    }),
  ).rejects.toThrow(
    "Invalid validationMode: sometimes. Expected one of always, after_tool, off.",
  );
});
