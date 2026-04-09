import { z } from "zod";

import type { ToolDefinition } from "../base";
import {
  getCurrentDateTime,
  type DateTimeInput,
  type DateTimeResult,
} from "./service";

const dateTimeSchema = z.object({
  timeZone: z.string().trim().min(1).optional(),
});

export const getDateTimeTool = {
  name: "get_datetime",
  description:
    "Get the current date and time, optionally in a specific IANA timezone.",
  whenToUse:
    "Use when the user asks for the current date, current time, today's date, or the time in a specific timezone.",
  exampleArgs: {
    timeZone: "Australia/Perth",
  },
  schema: dateTimeSchema,
  run: async (input) => getCurrentDateTime(input),
} satisfies ToolDefinition<DateTimeInput, DateTimeResult>;
