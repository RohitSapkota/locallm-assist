import { expect, test } from "bun:test";

import {
  createModelClient,
  ModelClientError,
  parseModelText,
  serializeMessages,
} from "./llm";

test("parses the explicit final protocol", () => {
  expect(parseModelText('{"type":"final","text":"Hello"}')).toEqual({
    type: "final",
    text: "Hello",
  });
});

test("parses the explicit tool protocol", () => {
  expect(
    parseModelText(
      '{"type":"tool","tool":"get_weather","arguments":{"city":"Perth"}}',
    ),
  ).toEqual({
    type: "tool",
    tool: "get_weather",
    arguments: { city: "Perth" },
  });
});

test("fails fast on malformed or invalid protocol JSON", () => {
  expect(() => parseModelText("Hello")).toThrow(
    "Model returned malformed JSON",
  );
  expect(() => parseModelText('{"tool":"get_weather"')).toThrow(
    "Model returned malformed JSON",
  );
  expect(() => parseModelText("{}")).toThrow(
    "Model returned invalid protocol response",
  );
});

test("serializes transcript messages without extra fields", () => {
  expect(
    serializeMessages([
      { role: "system", content: "system" },
      { role: "user", content: "user" },
      { role: "assistant", content: "assistant" },
    ]),
  ).toEqual([
    { role: "system", content: "system" },
    { role: "user", content: "user" },
    { role: "assistant", content: "assistant" },
  ]);
});

test("createModelClient posts messages and parses a successful response", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const fetchMock = (async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    capturedUrl = String(url);
    capturedInit = init;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"type":"final","text":"Hello from model"}',
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const client = createModelClient("http://127.0.0.1:9000", {
    model: "test-model",
    timeoutMs: 1_000,
    temperature: 0.2,
    maxTokens: 123,
    fetchImpl: fetchMock,
  });

  await expect(
    client([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ]),
  ).resolves.toEqual({
    type: "final",
    text: "Hello from model",
  });

  expect(capturedUrl).toBe("http://127.0.0.1:9000/v1/chat/completions");
  expect(capturedInit?.signal).toBeDefined();
  expect(capturedInit?.method).toBe("POST");
  expect(capturedInit?.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(String(capturedInit?.body))).toEqual({
    model: "test-model",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ],
    temperature: 0.2,
    max_tokens: 123,
  });
});

test("createModelClient surfaces non-200 responses", async () => {
  const fetchMock = (async () =>
    new Response("Bad gateway", { status: 502 })) as unknown as typeof fetch;

  const client = createModelClient("http://127.0.0.1:9000", {
    fetchImpl: fetchMock,
  });

  await expect(client([{ role: "user", content: "hello" }])).rejects.toThrow(
    "Model request failed: 502 Bad gateway",
  );
});

test("createModelClient rejects malformed JSON responses", async () => {
  const fetchMock = (async () =>
    new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

  const client = createModelClient("http://127.0.0.1:9000", {
    fetchImpl: fetchMock,
  });

  await expect(client([{ role: "user", content: "hello" }])).rejects.toThrow(
    "Model response was not valid JSON",
  );
});

test("createModelClient rejects missing message content", async () => {
  const fetchMock = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: {} }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const client = createModelClient("http://127.0.0.1:9000", {
    fetchImpl: fetchMock,
  });

  await expect(client([{ role: "user", content: "hello" }])).rejects.toThrow(
    "Model response missing text",
  );
});

test("createModelClient times out stalled requests", async () => {
  const fetchMock = ((
    _: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as unknown as typeof fetch;

  const client = createModelClient("http://127.0.0.1:9000", {
    timeoutMs: 1,
    fetchImpl: fetchMock,
  });

  await expect(client([{ role: "user", content: "hello" }])).rejects.toThrow(
    "Model request timed out after 1ms",
  );
});

test("createModelClient times out while reading response body", async () => {
  const fetchMock = (async (
    _: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const signal = init?.signal;

    return {
      ok: true,
      status: 200,
      json: () =>
        new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const client = createModelClient("http://127.0.0.1:9000", {
    timeoutMs: 1,
    fetchImpl: fetchMock,
  });

  await expect(client([{ role: "user", content: "hello" }])).rejects.toThrow(
    "Model request timed out after 1ms",
  );
});

test("createModelClient validates base URL and options", () => {
  expect(() => createModelClient("not-a-url")).toThrow(
    "Invalid model base URL: not-a-url",
  );
  expect(() => createModelClient("ftp://127.0.0.1:9000")).toThrow(
    "Unsupported model base URL protocol: ftp:",
  );
  expect(() =>
    createModelClient("http://127.0.0.1:9000", { timeoutMs: 0 }),
  ).toThrow("Invalid model timeoutMs: 0");
  expect(() =>
    createModelClient("http://127.0.0.1:9000", { temperature: Number.NaN }),
  ).toThrow("Invalid model temperature: NaN");
  expect(() =>
    createModelClient("http://127.0.0.1:9000", { maxTokens: 0 }),
  ).toThrow("Invalid model maxTokens: 0");
  expect(() =>
    createModelClient("http://127.0.0.1:9000", { model: "   " }),
  ).toThrow("Invalid model name: must be a non-empty string");
});

test("createModelClient throws typed errors for downstream handling", async () => {
  const fetchMock = (async () =>
    new Response("Bad gateway", { status: 502 })) as unknown as typeof fetch;
  const client = createModelClient("http://127.0.0.1:9000", {
    fetchImpl: fetchMock,
  });

  let captured: unknown;
  try {
    await client([{ role: "user", content: "hello" }]);
  } catch (error) {
    captured = error;
  }

  expect(captured).toBeInstanceOf(ModelClientError);
  expect((captured as ModelClientError).code).toBe("request_failed");
});
