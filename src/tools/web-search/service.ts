import { ToolError, type ToolContext } from "../base";

export type WebSearchInput = {
  query: string;
  limit?: number;
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string | null;
};

export type WebSearchResult = {
  provider: "duckduckgo";
  query: string;
  results: WebSearchResultItem[];
};

type FetchWebSearchOptions = {
  timeoutMs?: number;
};

type SearchResultAccumulator = {
  titleParts: string[];
  url: string;
  snippetParts: string[];
};

const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";
const SEARCH_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_RESULT_LIMIT = 5;
const NO_RESULTS_PATTERN =
  /\b(no results|did not match any documents|no more results)\b/i;
const SUPPORTED_RESULT_PROTOCOLS = new Set(["http:", "https:"]);

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function resolveResultUrl(rawHref: string | null) {
  if (!rawHref) {
    return null;
  }

  const trimmedHref = rawHref.trim();
  if (!trimmedHref) {
    return null;
  }

  let parsedHref: URL;
  try {
    parsedHref = new URL(
      trimmedHref.startsWith("//") ? `https:${trimmedHref}` : trimmedHref,
      DUCKDUCKGO_HTML_SEARCH_URL,
    );
  } catch {
    return null;
  }

  const redirectTarget = parsedHref.searchParams.get("uddg");
  if (redirectTarget) {
    try {
      const parsedTarget = new URL(redirectTarget);
      if (SUPPORTED_RESULT_PROTOCOLS.has(parsedTarget.protocol)) {
        return parsedTarget.toString();
      }
    } catch {
      return null;
    }
  }

  if (!SUPPORTED_RESULT_PROTOCOLS.has(parsedHref.protocol)) {
    return null;
  }

  return parsedHref.toString();
}

async function fetchSearchPageHtml(
  query: string,
  context: ToolContext,
  timeoutMs: number,
) {
  const searchUrl = new URL(DUCKDUCKGO_HTML_SEARCH_URL);
  searchUrl.searchParams.set("q", query);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await context.fetch(searchUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "locallm-assist/1.0",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ToolError(
        "external_service_error",
        `Web search request timed out after ${timeoutMs}ms`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    throw new ToolError(
      "external_service_error",
      `Web search request failed: ${res.status} ${await res.text()}`,
    );
  }

  return res.text();
}

async function extractSearchResults(
  html: string,
  limit: number,
): Promise<WebSearchResultItem[]> {
  const seenUrls = new Set<string>();
  const pendingResults: SearchResultAccumulator[] = [];
  let activeTitleResult: SearchResultAccumulator | null = null;
  let activeSnippetResult: SearchResultAccumulator | null = null;

  const startResult = (rawHref: string | null) => {
    const url = resolveResultUrl(rawHref);
    if (!url || seenUrls.has(url)) {
      activeTitleResult = null;
      return;
    }

    const result: SearchResultAccumulator = {
      titleParts: [],
      url,
      snippetParts: [],
    };

    seenUrls.add(url);
    pendingResults.push(result);
    activeTitleResult = result;
  };

  const setActiveSnippetResult = () => {
    const latestResult = pendingResults.at(-1);
    activeSnippetResult = latestResult ?? null;
  };

  await new HTMLRewriter()
    .on("a.result__a", {
      element(element) {
        startResult(element.getAttribute("href"));
      },
      text(text) {
        activeTitleResult?.titleParts.push(text.text);
      },
    })
    .on("a.result-link", {
      element(element) {
        startResult(element.getAttribute("href"));
      },
      text(text) {
        activeTitleResult?.titleParts.push(text.text);
      },
    })
    .on(".result__snippet", {
      element() {
        setActiveSnippetResult();
      },
      text(text) {
        activeSnippetResult?.snippetParts.push(text.text);
      },
    })
    .on("td.result-snippet", {
      element() {
        setActiveSnippetResult();
      },
      text(text) {
        activeSnippetResult?.snippetParts.push(text.text);
      },
    })
    .transform(new Response(html))
    .text();

  const results = pendingResults
    .map<WebSearchResultItem | null>((result) => {
      const title = collapseWhitespace(result.titleParts.join(""));
      if (!title) {
        return null;
      }

      const snippet = collapseWhitespace(result.snippetParts.join(""));

      return {
        title,
        url: result.url,
        snippet: snippet || null,
      };
    })
    .filter((result): result is WebSearchResultItem => result !== null)
    .slice(0, limit);

  if (results.length === 0 && !NO_RESULTS_PATTERN.test(html)) {
    throw new ToolError(
      "external_service_error",
      "Search provider returned an unreadable results page",
    );
  }

  return results;
}

export async function fetchWebSearchResults(
  input: WebSearchInput,
  context: ToolContext,
  options: FetchWebSearchOptions = {},
): Promise<WebSearchResult> {
  const timeoutMs = options.timeoutMs ?? SEARCH_REQUEST_TIMEOUT_MS;
  const limit = input.limit ?? DEFAULT_RESULT_LIMIT;
  const html = await fetchSearchPageHtml(input.query, context, timeoutMs);
  const results = await extractSearchResults(html, limit);

  return {
    provider: "duckduckgo",
    query: input.query,
    results,
  };
}
