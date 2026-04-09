import { z } from "zod";

import type { ToolDefinition } from "../base";
import {
  fetchWeatherByCity,
  type WeatherInput,
  type WeatherResult,
} from "./service";

const weatherSchema = z.object({
  city: z.string().trim().min(2),
  region: z.string().trim().min(2).optional(),
  country: z.string().trim().min(2).optional(),
});

export const getWeatherTool = {
  name: "get_weather",
  description:
    "Get current weather for a city, optionally using region or country to disambiguate. Accepts common country codes and selected region abbreviations.",
  whenToUse:
    "Use when the user asks for current weather or current conditions for a location.",
  exampleArgs: {
    city: "city name",
    region: "state or region if needed, for example WA",
    country: "country if needed, for example AU",
  },
  schema: weatherSchema,
  run: async (input, context) => fetchWeatherByCity(input, context),
} satisfies ToolDefinition<WeatherInput, WeatherResult>;
