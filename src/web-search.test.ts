import { expect, test } from "bun:test";

import { createToolContext } from "./tools/base";
import { fetchWebSearchResults } from "./tools/web-search/service";

test("fetches and parses web search results", async () => {
  const calls: string[] = [];
  const fetchMock = (async (input, init) => {
    expect(init?.signal).toBeDefined();
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    return new Response(`
      <html>
        <body>
          <div class="result">
            <h2 class="result__title">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fposts%2Flocal-llm">
                Local <b>LLM</b> roundup
              </a>
            </h2>
            <div class="result__snippet">Latest coverage of open-weight model releases.</div>
          </div>
          <table>
            <tr>
              <td>
                <a class="result-link" href="https://example.org/news/agents">Agent search news</a>
              </td>
            </tr>
            <tr>
              <td class="result-snippet">Product updates for search-enabled agents.</td>
            </tr>
            <tr>
              <td>
                <a class="result-link" href="https://example.net/blog/tooling">Third result</a>
              </td>
            </tr>
            <tr>
              <td class="result-snippet">This entry should be trimmed by the limit.</td>
            </tr>
          </table>
        </body>
      </html>
    `);
  }) as typeof fetch;

  await expect(
    fetchWebSearchResults(
      { query: "local llm", limit: 2 },
      createToolContext({ fetch: fetchMock }),
    ),
  ).resolves.toEqual({
    provider: "duckduckgo",
    query: "local llm",
    results: [
      {
        title: "Local LLM roundup",
        url: "https://example.com/posts/local-llm",
        snippet: "Latest coverage of open-weight model releases.",
      },
      {
        title: "Agent search news",
        url: "https://example.org/news/agents",
        snippet: "Product updates for search-enabled agents.",
      },
    ],
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("https://html.duckduckgo.com/html/");
  expect(calls[0]).toContain("q=local+llm");
});

test("returns an empty result set when the provider reports no matches", async () => {
  const fetchMock = (async () =>
    new Response(`
      <html>
        <body>
          <p>No results found for local llm</p>
        </body>
      </html>
    `)) as unknown as typeof fetch;

  await expect(
    fetchWebSearchResults(
      { query: "local llm" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).resolves.toEqual({
    provider: "duckduckgo",
    query: "local llm",
    results: [],
  });
});

test("surfaces a provider-shape error when no results can be parsed", async () => {
  const fetchMock = (async () =>
    new Response(`
      <html>
        <body>
          <h1>Verification required</h1>
        </body>
      </html>
    `)) as unknown as typeof fetch;

  await expect(
    fetchWebSearchResults(
      { query: "local llm" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).rejects.toThrow("Search provider returned an unreadable results page");
});
