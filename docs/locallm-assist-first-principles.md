# locallm-assist in First Principles

This project is a small command-line agent that lets a local language model answer real user questions more truthfully by giving it a minimal, explicit way to call a few tools.

The one-sentence summary is simple: if a local model is missing current facts or exact real-world data, the cheapest reliable fix is not a larger framework; it is a tight loop where the model can either answer directly or request one concrete tool call, then answer from the returned evidence.

## 1. Start From the Actual Problem

The core user outcome is simple: type a request into a CLI and get a useful answer back from a locally hosted model. That sounds easy until the request depends on fresh or precise information.

A raw local model has three predictable weaknesses:

- It does not know current weather, current time, or recent web information unless that data is fetched at runtime.
- It can hallucinate tool usage or facts if the protocol is vague.
- It performs worse when prompts grow long, especially on smaller local models with tighter context budgets.

From first principles, the project therefore does not need a giant agent platform. It needs the smallest system that can do four things reliably:

- Accept an explicit user request from the command line.
- Let the model either answer or ask for a tool in a machine-checkable format.
- Execute that tool safely and return structured results.
- Keep the loop bounded so a local model does not drift, bloat the prompt, or spin forever.

## 2. Facts, Constraints, and Deleted Assumptions

Facts in the repo:

- The entrypoint is src/main.ts.
- The runtime agent loop is in src/agent.ts.
- The model client talks to an OpenAI-style chat endpoint in src/llm.ts.
- Tools are modular under src/tools/.
- The current built-in tools are weather, web search, and current date/time.

Real constraints:

- The model is local, so latency and context size matter more than in large hosted systems.
- Fresh facts must come from external services at runtime.
- The model must be forced into a narrow output contract or the loop becomes brittle.
- Prompt growth must stay bounded because token counting is only estimated, not exact.

The project also deliberately deletes a few bad defaults:

- No hidden fallback prompt. The CLI requires an explicit request.
- No free-form model protocol. The model must return JSON shaped as either a final answer or a tool call.
- No full transcript replay forever. The runtime rebuilds a compact prompt from the request plus bounded tool history.
- No monolithic tool file. Each tool owns its schema and provider code.

## 3. The Smallest System That Works

The runtime flow is:

- Step 1: The CLI parses the request and runtime options in src/main.ts.
- Step 2: The agent loop builds a strict system prompt in src/agent.ts.
- Step 3: The model can return only one of two JSON shapes: {"type":"final"} or {"type":"tool"}.
- Step 4: If the model asks for a tool, the registry validates arguments with Zod, runs the tool, and converts the result into structured success or failure output.
- Step 5: The structured tool result is fed back to the model as evidence.
- Step 6: An optional validation cycle checks the draft answer against the request and tool evidence before accepting it.
- Step 7: The loop stops when a final answer is accepted or a step limit is reached.

This architecture is intentionally narrow. It avoids planning layers, memory systems, multi-agent orchestration, and dynamic tool discovery because none of those are required for the current user outcome.

## 4. Architecture Diagram

The runtime boundary looks like this:

```text
+--------------------------+
| User request in CLI      |
+------------+-------------+
             |
             v
+--------------------------+
| src/main.ts              |
| parse args + profile     |
+------------+-------------+
             |
             v
+--------------------------+      OpenAI-style JSON      +-------------------+
| src/agent.ts             | <-------------------------> | src/llm.ts        |
| bounded loop             |                             | local model API   |
| final or tool decision   |                             +-------------------+
+------+-------------------+
       |
       | tool call
       v
+--------------------------+
| Tool registry            |
| validate args, run tool  |
| return success/error     |
+----+-----------+---------+
     |           |         |
     v           v         v
+--------+   +--------+  +--------+
|datetime|   |weather |  |search  |
|tool    |   |tool    |  |tool    |
+---+----+   +---+----+  +---+----+
    |            |           |
    v            v           v
 local clock   Open-Meteo  DuckDuckGo
        \         |           /
         +--------+----------+
                  |
                  v
       structured tool result
                  |
                  v
             src/agent.ts
                  |
                  v
         final answer to user
```

The key boundary is that the model does not talk to external services directly. It can only emit a typed tool request, and the runtime decides what actually executes.

## 5. Why Each Major Part Exists

src/main.ts exists to keep the interface honest. It validates CLI flags, forces an explicit prompt, chooses a runtime profile, and optionally prints trace logs to stderr. Its job is not intelligence; its job is to make the runtime predictable.

src/llm.ts is the thinnest useful model adapter. The model client sends serialized chat messages to a local server that exposes an OpenAI-compatible endpoint. It validates configuration, enforces timeouts, and parses the model response into one of the two allowed JSON result types. This is the minimum needed to keep the model from becoming an untyped string generator.

src/agent.ts is the project's real center. It turns the model into a bounded decision machine: answer now, or call one tool with arguments. The file also handles validation cycles and prompt budgeting. Those controls exist because local models are more fragile than frontier hosted models, so the runtime has to protect them from unnecessary prompt growth and unverified conclusions.

src/tools/registry.ts and src/tools/base.ts define the explicit tool contract: tool metadata for the prompt, Zod-based argument validation, and a consistent success or error shape. The model can then react to ambiguity or provider failures without the process crashing.

The current tools under src/tools/ each serve one narrow purpose:

- weather fetches current conditions from Open-Meteo after city resolution.
- web-search fetches public search results from DuckDuckGo HTML search.
- datetime returns current time data for the local or requested timezone.

They are separate because provider-specific complexity should stay local instead of contaminating the whole codebase.

## 6. What Makes This "First Principles" Instead of "Agent Theater"

The repository standard in AGENTS.md says to question requirements, delete unnecessary parts, simplify what remains, accelerate feedback, and only then automate. This project follows that pattern fairly closely.

- Question the requirement: the project does not assume it needs chat history, memory, personas, or multi-step planning for every request.
- Delete unnecessary parts: it removed hidden prompt defaults and stopped replaying the whole transcript on every turn.
- Simplify: the model protocol has only two legal response types.
- Accelerate feedback: tests cover parsing, tool behavior, validation flow, and error handling; trace logs expose each step of a live run.
- Automate last: tool registration is modular, but still explicit. New capability is added only when there is a concrete tool for it.

In other words, the project is not trying to simulate a sophisticated autonomous system. It is trying to build a small, inspectable runtime that improves answer quality for common CLI queries.

## 7. Design Tradeoffs

What this design gains:

- Small code surface and low mental overhead.
- Clear failure modes because tools return structured errors.
- Better fit for local models through bounded steps and compact prompts.
- Easy extension path: add a tool folder, register it once, and expose it to the agent prompt.

What this design intentionally does not solve yet:

- It does not provide long-term memory or persistent conversation state.
- It does not use an exact tokenizer, so prompt budgeting is approximate.
- It does not guarantee citation-grade web research; the search tool returns titles, URLs, and snippets only.
- It depends on outbound internet access for weather and web search tools.
- It is single-agent and serial by design.

## 8. Plain-English Architecture Summary

locallm-assist is a disciplined wrapper around a local LLM. The wrapper narrows the model's choices, gives it a few external senses, and refuses to let the interaction sprawl. That is the whole idea.

The reason that matters is simple: most failures in local-agent experiments come from asking too much of the model and too little of the runtime. This project shifts some responsibility out of the model and into explicit software rules.

## 9. Best Next Improvements Under the 5-Step Loop

- Delete more prompt waste before adding new tools. The biggest risk for local models is still context bloat.
- Replace rough token estimation with the backend model's actual tokenizer when practical.
- Add only tools tied to repeated real requests, such as filesystem lookup or calculator support, instead of speculative capabilities.
- Improve source-grounding for web answers if the project starts targeting research-style use cases.

Generated from the repository state on 2026-04-11. Primary source files reviewed: AGENTS.md, README.md, src/main.ts, src/agent.ts, src/llm.ts, src/tools/base.ts, src/tools/registry.ts, and current tool implementations.
