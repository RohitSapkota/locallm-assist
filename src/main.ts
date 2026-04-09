import { runAgent as defaultRunAgent } from "./agent";
import { ModelClientError } from "./llm";

const DEFAULT_BASE_URL = "http://127.0.0.1:9000";
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

export const CLI_USAGE = [
  "Usage:",
  '  bun run src/main.ts [--base-url URL] [--model MODEL] [--timeout-ms MS] "your request"',
  "",
  "Options:",
  "  --base-url URL   Model server base URL (http/https)",
  "  --model MODEL    Model name to send to the backend",
  "  --timeout-ms MS  Request timeout in milliseconds",
  "  -h, --help       Show this help text",
].join("\n");

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

type MainDependencies = {
  runAgent: typeof defaultRunAgent;
};

const DEFAULT_MAIN_DEPENDENCIES: MainDependencies = {
  runAgent: defaultRunAgent,
};

function parseBaseUrl(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new CliUsageError(`Invalid value for --base-url: ${value}`);
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new CliUsageError(
      `Unsupported protocol for --base-url: ${parsed.protocol}`,
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function getFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new CliUsageError(`Missing value for ${flag}`);
  }

  return value;
}

function parseTimeoutMs(value: string) {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliUsageError(`Invalid value for --timeout-ms: ${value}`);
  }

  return timeoutMs;
}

export function parseCliArgs(argv: string[]) {
  const inputParts: string[] = [];
  let baseUrl = DEFAULT_BASE_URL;
  let showHelp = false;
  let endOfFlags = false;
  let model: string | undefined;
  let timeoutMs: number | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (!endOfFlags && arg === "--") {
      endOfFlags = true;
      continue;
    }

    if (!endOfFlags && (arg === "--help" || arg === "-h")) {
      showHelp = true;
      continue;
    }

    if (!endOfFlags && arg === "--base-url") {
      const value = getFlagValue(argv, index, "--base-url");
      baseUrl = parseBaseUrl(value);
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--model") {
      model = getFlagValue(argv, index, "--model");
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--timeout-ms") {
      timeoutMs = parseTimeoutMs(getFlagValue(argv, index, "--timeout-ms"));
      index += 1;
      continue;
    }

    if (!endOfFlags && arg.startsWith("-")) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }

    inputParts.push(arg);
  }

  return {
    input: inputParts.join(" ").trim() || null,
    baseUrl,
    showHelp,
    ...(model !== undefined ? { model } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function formatCliError(error: unknown) {
  if (error instanceof ModelClientError) {
    return `Model client error [${error.code}]: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function main(
  argv = process.argv.slice(2),
  dependencies: MainDependencies = DEFAULT_MAIN_DEPENDENCIES,
) {
  const { input, baseUrl, showHelp, model, timeoutMs } = parseCliArgs(argv);
  if (showHelp) {
    return CLI_USAGE;
  }

  if (!input) {
    throw new CliUsageError("Missing request text.");
  }

  return dependencies.runAgent(input, baseUrl, { model, timeoutMs });
}

if (import.meta.main) {
  main()
    .then((out) => {
      console.log(out);
    })
    .catch((err) => {
      if (err instanceof CliUsageError) {
        console.error(err.message);
        console.error("");
        console.error(CLI_USAGE);
        process.exit(1);
      }

      console.error(formatCliError(err));
      process.exit(1);
    });
}
