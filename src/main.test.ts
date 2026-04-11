import { expect, test } from "bun:test";

import { ModelClientError } from "./llm";
import {
  formatCliError,
  main,
  parseCliArgs,
  resolveCliRuntimeOptions,
} from "./main";

test("parses input and base-url arguments", () => {
  expect(
    parseCliArgs([
      "--base-url",
      "http://127.0.0.1:9999",
      "--model",
      "test-model",
      "--timeout-ms",
      "5000",
      "What's",
      "the",
      "weather?",
    ]),
  ).toEqual({
    input: "What's the weather?",
    baseUrl: "http://127.0.0.1:9999",
    quiet: false,
    profile: "local-14b",
    showHelp: false,
    model: "test-model",
    timeoutMs: 5000,
  });
});

test("does not default to a hidden Perth query when no input is provided", () => {
  expect(parseCliArgs([])).toEqual({
    input: null,
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    profile: "local-14b",
    showHelp: false,
  });
});

test("supports help flags", () => {
  expect(parseCliArgs(["--help"])).toEqual({
    input: null,
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    profile: "local-14b",
    showHelp: true,
  });
  expect(parseCliArgs(["-h"])).toEqual({
    input: null,
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    profile: "local-14b",
    showHelp: true,
  });
});

test("supports quiet flag", () => {
  expect(parseCliArgs(["--quiet", "Hello"])).toEqual({
    input: "Hello",
    baseUrl: "http://127.0.0.1:9000",
    quiet: true,
    profile: "local-14b",
    showHelp: false,
  });
});

test("rejects unknown flags", () => {
  expect(() => parseCliArgs(["--baseurl", "hello"])).toThrow(
    "Unknown option: --baseurl",
  );
});

test("rejects missing or invalid --base-url values", () => {
  expect(() => parseCliArgs(["--base-url"])).toThrow(
    "Missing value for --base-url",
  );
  expect(() => parseCliArgs(["--base-url", "--help"])).toThrow(
    "Missing value for --base-url",
  );
  expect(() => parseCliArgs(["--base-url", "not-a-url", "hello"])).toThrow(
    "Invalid value for --base-url: not-a-url",
  );
  expect(() => parseCliArgs(["--base-url", "ftp://localhost:9000", "hello"])).toThrow(
    "Unsupported protocol for --base-url: ftp:",
  );
});

test("rejects missing or invalid model client option values", () => {
  expect(() => parseCliArgs(["--model"])).toThrow(
    "Missing value for --model",
  );
  expect(() => parseCliArgs(["--timeout-ms"])).toThrow(
    "Missing value for --timeout-ms",
  );
  expect(() => parseCliArgs(["--timeout-ms", "0", "hello"])).toThrow(
    "Invalid value for --timeout-ms: 0",
  );
  expect(() => parseCliArgs(["--timeout-ms", "abc", "hello"])).toThrow(
    "Invalid value for --timeout-ms: abc",
  );
  expect(() => parseCliArgs(["--profile", "remote", "hello"])).toThrow(
    "Invalid value for --profile: remote. Expected one of default, local-14b",
  );
  expect(() => parseCliArgs(["--validation", "sometimes", "hello"])).toThrow(
    "Invalid value for --validation: sometimes. Expected one of always, after_tool, off",
  );
  expect(() => parseCliArgs(["--max-steps", "0", "hello"])).toThrow(
    "Invalid value for --max-steps: 0",
  );
  expect(() => parseCliArgs(["--context-window", "abc", "hello"])).toThrow(
    "Invalid value for --context-window: abc",
  );
  expect(() => parseCliArgs(["--prompt-budget", "0", "hello"])).toThrow(
    "Invalid value for --prompt-budget: 0",
  );
  expect(() => parseCliArgs(["--max-output-tokens", "0", "hello"])).toThrow(
    "Invalid value for --max-output-tokens: 0",
  );
});

test("treats tokens after -- as prompt text", () => {
  expect(parseCliArgs(["--", "--base-url", "hello"])).toEqual({
    input: "--base-url hello",
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    profile: "local-14b",
    showHelp: false,
  });
});

test("resolves local-14b runtime defaults and allows explicit overrides", () => {
  expect(
    resolveCliRuntimeOptions(
      parseCliArgs([
        "--profile",
        "local-14b",
        "--max-steps",
        "6",
        "--validation",
        "off",
        "--context-window",
        "28000",
        "--prompt-budget",
        "16000",
        "--max-output-tokens",
        "512",
        "Hello",
      ]),
    ),
  ).toEqual({
    maxSteps: 6,
    validationCycles: 1,
    validationMode: "off",
    contextWindowTokens: 28000,
    promptBudgetTokens: 16000,
    maxOutputTokens: 512,
  });
});

test("main forwards parsed options to runAgent", async () => {
  let captured:
    | {
        input: string;
        baseUrl: string;
        options: {
          model?: string;
          timeoutMs?: number;
          maxSteps?: number;
          validationCycles?: number;
          validationMode?: string;
          contextWindowTokens?: number;
          promptBudgetTokens?: number;
          maxOutputTokens?: number;
          trace?: (message: string) => void;
        };
      }
    | undefined;

  const runAgent = async (
    input: string,
    baseUrl: string,
    options: { model?: string; timeoutMs?: number } = {},
  ) => {
    captured = { input, baseUrl, options };
    return "ok";
  };

  await expect(
    main(
      [
        "--base-url",
        "http://127.0.0.1:9999",
        "--model",
        "test-model",
        "--timeout-ms",
        "5000",
        "Hello",
      ],
      { runAgent },
    ),
  ).resolves.toBe("ok");

  expect(captured?.input).toBe("Hello");
  expect(captured?.baseUrl).toBe("http://127.0.0.1:9999");
  expect(captured?.options.model).toBe("test-model");
  expect(captured?.options.timeoutMs).toBe(5000);
  expect(captured?.options.maxSteps).toBe(4);
  expect(captured?.options.validationCycles).toBe(1);
  expect(captured?.options.validationMode).toBe("after_tool");
  expect(captured?.options.contextWindowTokens).toBe(32768);
  expect(captured?.options.promptBudgetTokens).toBe(18000);
  expect(captured?.options.maxOutputTokens).toBe(640);
  expect(captured?.options.trace).toBeTypeOf("function");
});

test("main suppresses trace forwarding in quiet mode", async () => {
  let captured:
    | {
        input: string;
        baseUrl: string;
        options: {
          model?: string;
          timeoutMs?: number;
          maxSteps?: number;
          validationCycles?: number;
          validationMode?: string;
          contextWindowTokens?: number;
          promptBudgetTokens?: number;
          maxOutputTokens?: number;
          trace?: (message: string) => void;
        };
      }
    | undefined;

  const runAgent = async (
    input: string,
    baseUrl: string,
    options: { model?: string; timeoutMs?: number; trace?: (message: string) => void } = {},
  ) => {
    captured = { input, baseUrl, options };
    return "ok";
  };

  await expect(main(["--quiet", "Hello"], { runAgent })).resolves.toBe("ok");

  expect(captured?.input).toBe("Hello");
  expect(captured?.baseUrl).toBe("http://127.0.0.1:9000");
  expect(captured?.options.maxSteps).toBe(4);
  expect(captured?.options.validationCycles).toBe(1);
  expect(captured?.options.validationMode).toBe("after_tool");
  expect(captured?.options.contextWindowTokens).toBe(32768);
  expect(captured?.options.promptBudgetTokens).toBe(18000);
  expect(captured?.options.maxOutputTokens).toBe(640);
  expect(captured?.options.trace).toBeUndefined();
});

test("formats model client errors without stack output", () => {
  expect(
    formatCliError(
      new ModelClientError(
        "timeout",
        "Model request timed out after 1ms",
      ),
    ),
  ).toBe("Model client error [timeout]: Model request timed out after 1ms");
});
