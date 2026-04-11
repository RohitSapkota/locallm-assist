# locallm-assist

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/main.ts -- "What's the weather in Perth, Western Australia?"
```

The agent now also has a `search_web` tool for public web lookup. For example:

```bash
bun run src/main.ts -- "Search the web for the latest Bun 1.3 release notes and summarize the top results."
```

It also has a `get_datetime` tool for current date/time questions. For example:

```bash
bun run src/main.ts -- "What time is it in Australia/Perth right now?"
```

To override the model endpoint:

```bash
bun run src/main.ts --base-url http://127.0.0.1:9000 -- "What's the weather in Perth, Western Australia?"
```

To pass an explicit model name and request timeout:

```bash
bun run src/main.ts --model my-model --timeout-ms 15000 -- "What's the weather in Perth, Western Australia?"
```

The CLI now defaults to the `local-14b` runtime profile. This matches Qwen2.5-14B's default context setup more closely: 32,768 tokens by default, with 131,072 available only if you explicitly enable YaRN or another long-context configuration in your backend. The runtime still keeps a conservative prompt budget because this project currently uses a rough token estimate instead of the model's exact tokenizer:

- `maxSteps=4`
- `validationMode=after_tool`
- `validationCycles=1`
- `contextWindowTokens=32768`
- `promptBudgetTokens=18000`
- `maxOutputTokens=640`

To switch back to the legacy higher-latency defaults or override only one limit:

```bash
bun run src/main.ts --profile default -- "What's the weather in Perth, Western Australia?"
bun run src/main.ts --max-output-tokens 512 --max-steps 3 -- "Summarize the latest Bun release notes"
```

To print CLI help:

```bash
bun run src/main.ts --help
```

To suppress backend progress logs:

```bash
bun run src/main.ts --quiet -- "What's the weather in Perth, Western Australia?"
```

`get_weather` resolves the city through Open-Meteo geocoding and then fetches current conditions from Open-Meteo's forecast API, so the tool requires outbound internet access when it runs. If a city name is ambiguous, include `country` or `region`. Common country codes like `US`, `USA`, `UK`, and `AU` are normalized, and selected region abbreviations like `WA` are supported where the mapping is unambiguous. If your filter misses, the tool returns the exact city matches it did find.

`search_web` uses DuckDuckGo's HTML search endpoint and returns a short result list with titles, URLs, and snippets. It also requires outbound internet access when it runs.

`get_datetime` returns the current UTC timestamp plus a stable `date`, `time`, and `dateTime` in either the local default timezone or an explicitly requested IANA timezone like `UTC` or `Australia/Perth`.

The CLI no longer falls back to a hidden default prompt. You must pass an explicit request.
Unknown flags are rejected, and `--base-url` must be a valid `http` or `https` URL.
`--timeout-ms` must be a positive integer.
`--max-steps`, `--context-window`, `--prompt-budget`, and `--max-output-tokens` must be positive integers.
`--validation` must be one of `always`, `after_tool`, or `off`.
Use `--quiet` to suppress backend progress trace output.

This project now defaults to first-principles reasoning plus the 5-step improvement loop documented in [AGENTS.md](./AGENTS.md). The runtime agent prompt follows the same standard by default.

The default `local-14b` profile runs one validation cycle only after new tool evidence. If you switch to `--profile default`, the older two-cycle always-validate behavior is still available.

The runtime no longer replays the full raw transcript on every step. It rebuilds a compact prompt each turn from the original request, a bounded summary of prior tool facts, and the current pending tool or validation turn. This keeps prompt growth flatter on smaller local models.

When you run the CLI, backend progress is printed to `stderr` with `[agent]` prefixes so you can see model turns, validation passes, and tool calls while the final answer remains on `stdout`.

The model protocol is JSON-only and uses these response shapes:

```json
{"type":"final","text":"Plain-language answer for the user"}
{"type":"tool","tool":"tool_name","arguments":{}}
```

Tool definitions are now modular. Add new tools under [`src/tools/`](./src/tools/) as isolated folders, then register them once in [`src/tools/index.ts`](./src/tools/index.ts). Keep provider-specific code beside the tool instead of growing one shared file.

To run tests:

```bash
bun test
```

To run the type check:

```bash
bun run check
```

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
