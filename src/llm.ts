import { z } from "zod";

export type TranscriptMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

const finalResponseSchema = z.object({
  type: z.literal("final"),
  text: z.string(),
});

const toolResponseSchema = z.object({
  type: z.literal("tool"),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

const modelResponseSchema = z.discriminatedUnion("type", [
  finalResponseSchema,
  toolResponseSchema,
]);

export type ModelResult = z.infer<typeof modelResponseSchema>;

export type ModelClient = (
  messages: TranscriptMessage[],
) => Promise<ModelResult>;

const responseTextSchema = z.string();
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TEMPERATURE = 0;
export const DEFAULT_MAX_OUTPUT_TOKENS = 400;
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

type ModelClientErrorCode =
  | "config"
  | "timeout"
  | "request_failed"
  | "invalid_json"
  | "missing_text"
  | "invalid_protocol";

export class ModelClientError extends Error {
  readonly code: ModelClientErrorCode;

  constructor(code: ModelClientErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ModelClientError";
  }
}

export type ModelClientOptions = {
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
};

type ResolvedModelClientOptions = {
  normalizedBaseUrl: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  model?: string;
  fetchImpl: typeof fetch;
};

function normalizeBaseUrl(baseUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ModelClientError("config", `Invalid model base URL: ${baseUrl}`);
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new ModelClientError(
      "config",
      `Unsupported model base URL protocol: ${parsed.protocol}`,
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function resolveModelClientOptions(
  baseUrl: string,
  options: ModelClientOptions,
): ResolvedModelClientOptions {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ModelClientError(
      "config",
      `Invalid model timeoutMs: ${String(timeoutMs)}`,
    );
  }

  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  if (!Number.isFinite(temperature)) {
    throw new ModelClientError(
      "config",
      `Invalid model temperature: ${String(temperature)}`,
    );
  }

  if (
    options.maxTokens !== undefined &&
    options.maxOutputTokens !== undefined &&
    options.maxTokens !== options.maxOutputTokens
  ) {
    throw new ModelClientError(
      "config",
      `Conflicting model max token values: maxTokens=${options.maxTokens}, maxOutputTokens=${options.maxOutputTokens}`,
    );
  }

  const maxTokens =
    options.maxOutputTokens ?? options.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new ModelClientError(
      "config",
      `Invalid model maxTokens: ${String(maxTokens)}`,
    );
  }

  let model: string | undefined;
  if (options.model !== undefined) {
    const trimmedModel = options.model.trim();
    if (!trimmedModel) {
      throw new ModelClientError(
        "config",
        "Invalid model name: must be a non-empty string",
      );
    }

    model = trimmedModel;
  }

  return {
    normalizedBaseUrl: normalizeBaseUrl(baseUrl),
    timeoutMs,
    temperature,
    maxTokens,
    ...(model !== undefined ? { model } : {}),
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

export function serializeMessages(messages: TranscriptMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function parseModelText(text: string): ModelResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model returned malformed JSON");
  }

  const result = modelResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Model returned invalid protocol response");
  }

  return result.data;
}

export function createModelClient(
  baseUrl: string,
  options: ModelClientOptions = {},
): ModelClient {
  const resolvedOptions = resolveModelClientOptions(baseUrl, options);

  return async (messages) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      resolvedOptions.timeoutMs,
    );

    const requestBody = {
      messages: serializeMessages(messages),
      temperature: resolvedOptions.temperature,
      max_tokens: resolvedOptions.maxTokens,
      ...(resolvedOptions.model ? { model: resolvedOptions.model } : {}),
    };

    try {
      const res = await resolvedOptions.fetchImpl(
        `${resolvedOptions.normalizedBaseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        throw new ModelClientError(
          "request_failed",
          `Model request failed: ${res.status} ${await res.text()}`,
        );
      }

      let data: { choices?: Array<{ message?: { content?: unknown } }> };
      try {
        data = (await res.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }

        throw new ModelClientError(
          "invalid_json",
          "Model response was not valid JSON",
        );
      }

      const textResult = responseTextSchema.safeParse(
        data.choices?.[0]?.message?.content,
      );

      if (!textResult.success) {
        throw new ModelClientError("missing_text", "Model response missing text");
      }

      try {
        return parseModelText(textResult.data);
      } catch (error) {
        if (error instanceof Error) {
          throw new ModelClientError("invalid_protocol", error.message);
        }

        throw error;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ModelClientError(
          "timeout",
          `Model request timed out after ${resolvedOptions.timeoutMs}ms`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
