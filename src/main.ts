import {
  runAgent as defaultRunAgent,
  type AgentTraceWriter,
  type ValidationMode,
  VALIDATION_MODES,
} from "./agent";
import { DEFAULT_MAX_OUTPUT_TOKENS, ModelClientError } from "./llm";

const DEFAULT_BASE_URL = "http://127.0.0.1:9000";
const DEFAULT_PROFILE = "local-14b";
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

type RuntimeProfileName = "default" | "local-14b";
type RuntimeProfile = {
  maxSteps: number;
  validationCycles: number;
  validationMode: ValidationMode;
  contextWindowTokens?: number;
  promptBudgetTokens?: number;
  maxOutputTokens: number;
};

const RUNTIME_PROFILES: Record<RuntimeProfileName, RuntimeProfile> = {
  default: {
    maxSteps: 12,
    validationCycles: 2,
    validationMode: "always",
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  },
  "local-14b": {
    maxSteps: 4,
    validationCycles: 1,
    validationMode: "after_tool",
    contextWindowTokens: 32_768,
    promptBudgetTokens: 18_000,
    maxOutputTokens: 640,
  },
};

export const CLI_USAGE = [
  "Usage:",
  '  bun run src/main.ts [--base-url URL] [--model MODEL] [--timeout-ms MS] [--profile NAME] [--max-steps N] [--validation MODE] [--context-window TOKENS] [--prompt-budget TOKENS] [--max-output-tokens TOKENS] [--quiet] "your request"',
  "",
  "Options:",
  "  --base-url URL   Model server base URL (http/https)",
  "  --model MODEL    Model name to send to the backend",
  "  --timeout-ms MS  Request timeout in milliseconds",
  `  --profile NAME   Runtime profile (${Object.keys(RUNTIME_PROFILES).join(", ")}). Default: ${DEFAULT_PROFILE}`,
  "  --max-steps N    Override the maximum number of agent steps",
  `  --validation MODE  Validation mode (${VALIDATION_MODES.join(", ")})`,
  "  --context-window TOKENS  Context window budget for prompt plus output",
  "  --prompt-budget TOKENS   Prompt-only token budget before output reservation",
  "  --max-output-tokens TOKENS  Maximum output tokens requested from the model",
  "  --quiet          Suppress backend progress trace output",
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

function createCliTraceWriter(): AgentTraceWriter {
  return (message) => {
    console.error(`[agent] ${message}`);
  };
}

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

function parsePositiveIntegerFlag(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`Invalid value for ${flag}: ${value}`);
  }

  return parsed;
}

function parseProfile(value: string): RuntimeProfileName {
  if (value in RUNTIME_PROFILES) {
    return value as RuntimeProfileName;
  }

  throw new CliUsageError(
    `Invalid value for --profile: ${value}. Expected one of ${Object.keys(RUNTIME_PROFILES).join(", ")}`,
  );
}

function parseValidationMode(value: string): ValidationMode {
  if (VALIDATION_MODES.includes(value as ValidationMode)) {
    return value as ValidationMode;
  }

  throw new CliUsageError(
    `Invalid value for --validation: ${value}. Expected one of ${VALIDATION_MODES.join(", ")}`,
  );
}

export function parseCliArgs(argv: string[]) {
  const inputParts: string[] = [];
  let baseUrl = DEFAULT_BASE_URL;
  let showHelp = false;
  let quiet = false;
  let endOfFlags = false;
  let model: string | undefined;
  let timeoutMs: number | undefined;
  let profile: RuntimeProfileName = DEFAULT_PROFILE;
  let maxSteps: number | undefined;
  let validationMode: ValidationMode | undefined;
  let contextWindowTokens: number | undefined;
  let promptBudgetTokens: number | undefined;
  let maxOutputTokens: number | undefined;

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

    if (!endOfFlags && arg === "--quiet") {
      quiet = true;
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

    if (!endOfFlags && arg === "--profile") {
      profile = parseProfile(getFlagValue(argv, index, "--profile"));
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--max-steps") {
      maxSteps = parsePositiveIntegerFlag(
        getFlagValue(argv, index, "--max-steps"),
        "--max-steps",
      );
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--validation") {
      validationMode = parseValidationMode(
        getFlagValue(argv, index, "--validation"),
      );
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--context-window") {
      contextWindowTokens = parsePositiveIntegerFlag(
        getFlagValue(argv, index, "--context-window"),
        "--context-window",
      );
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--prompt-budget") {
      promptBudgetTokens = parsePositiveIntegerFlag(
        getFlagValue(argv, index, "--prompt-budget"),
        "--prompt-budget",
      );
      index += 1;
      continue;
    }

    if (!endOfFlags && arg === "--max-output-tokens") {
      maxOutputTokens = parsePositiveIntegerFlag(
        getFlagValue(argv, index, "--max-output-tokens"),
        "--max-output-tokens",
      );
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
    quiet,
    profile,
    showHelp,
    ...(model !== undefined ? { model } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(validationMode !== undefined ? { validationMode } : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
    ...(promptBudgetTokens !== undefined ? { promptBudgetTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };
}

export function resolveCliRuntimeOptions(
  args: ReturnType<typeof parseCliArgs>,
) {
  const profile = RUNTIME_PROFILES[args.profile];

  return {
    maxSteps: args.maxSteps ?? profile.maxSteps,
    validationCycles: profile.validationCycles,
    validationMode: args.validationMode ?? profile.validationMode,
    contextWindowTokens:
      args.contextWindowTokens ?? profile.contextWindowTokens,
    promptBudgetTokens:
      args.promptBudgetTokens ?? profile.promptBudgetTokens,
    maxOutputTokens: args.maxOutputTokens ?? profile.maxOutputTokens,
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
  const {
    input,
    baseUrl,
    quiet,
    showHelp,
    model,
    timeoutMs,
    ...parsedArgs
  } = parseCliArgs(argv);
  if (showHelp) {
    return CLI_USAGE;
  }

  if (!input) {
    throw new CliUsageError("Missing request text.");
  }

  const runtimeOptions = resolveCliRuntimeOptions({
    input,
    baseUrl,
    quiet,
    showHelp,
    model,
    timeoutMs,
    ...parsedArgs,
  });

  return dependencies.runAgent(input, baseUrl, {
    model,
    timeoutMs,
    ...runtimeOptions,
    ...(quiet ? {} : { trace: createCliTraceWriter() }),
  });
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
