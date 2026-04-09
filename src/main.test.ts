import { expect, test } from "bun:test";

import { ModelClientError } from "./llm";
import { formatCliError, main, parseCliArgs } from "./main";

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
    showHelp: false,
  });
});

test("supports help flags", () => {
  expect(parseCliArgs(["--help"])).toEqual({
    input: null,
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    showHelp: true,
  });
  expect(parseCliArgs(["-h"])).toEqual({
    input: null,
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    showHelp: true,
  });
});

test("supports quiet flag", () => {
  expect(parseCliArgs(["--quiet", "Hello"])).toEqual({
    input: "Hello",
    baseUrl: "http://127.0.0.1:9000",
    quiet: true,
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
});

test("treats tokens after -- as prompt text", () => {
  expect(parseCliArgs(["--", "--base-url", "hello"])).toEqual({
    input: "--base-url hello",
    baseUrl: "http://127.0.0.1:9000",
    quiet: false,
    showHelp: false,
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
