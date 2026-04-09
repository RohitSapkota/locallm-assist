# locallm-assist

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/main.ts -- "What's the weather in Perth, Western Australia?"
```

To override the model endpoint:

```bash
bun run src/main.ts --base-url http://127.0.0.1:9000 -- "What's the weather in Perth, Western Australia?"
```

To pass an explicit model name and request timeout:

```bash
bun run src/main.ts --model my-model --timeout-ms 15000 -- "What's the weather in Perth, Western Australia?"
```

To print CLI help:

```bash
bun run src/main.ts --help
```

`get_weather` resolves the city through Open-Meteo geocoding and then fetches current conditions from Open-Meteo's forecast API, so the tool now requires outbound internet access when it runs. If a city name is ambiguous, include `country` or `region`. Common country codes like `US`, `USA`, `UK`, and `AU` are normalized, and selected region abbreviations like `WA` are supported where the mapping is unambiguous. If your filter misses, the tool now returns the exact city matches it did find.

The CLI no longer falls back to a hidden default prompt. You must pass an explicit request.
Unknown flags are rejected, and `--base-url` must be a valid `http` or `https` URL.
`--timeout-ms` must be a positive integer.

This project now defaults to first-principles reasoning plus the 5-step improvement loop documented in [AGENTS.md](./AGENTS.md). The runtime agent prompt follows the same standard by default.

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
