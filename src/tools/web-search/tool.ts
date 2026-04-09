import { z } from "zod";

import type { ToolDefinition } from "../base";
import {
  fetchWebSearchResults,
  type WebSearchInput,
  type WebSearchResult,
} from "./service";

const webSearchSchema = z.object({
  query: z.string().trim().min(2),
  limit: z.int().min(1).max(8).optional(),
});

export const searchWebTool = {
  name: "search_web",
  description:
    "Search the public web and return a short list of result titles, URLs, and snippets.",
  whenToUse:
    "Use when the user asks for current information, recent changes, or facts that likely are not in the model context.",
  exampleArgs: {
    query: "latest Bun 1.3 release notes",
    limit: 5,
  },
  schema: webSearchSchema,
  run: async (input, context) => fetchWebSearchResults(input, context),
} satisfies ToolDefinition<WebSearchInput, WebSearchResult>;
