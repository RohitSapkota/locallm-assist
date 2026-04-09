import { z } from "zod";

import { ToolError, type ToolContext } from "../base";

export type WeatherInput = {
  city: string;
  region?: string;
  country?: string;
};

export type WeatherResult = {
  city: string;
  region: string | null;
  country: string;
  timezone: string;
  forecast: string;
  temperatureC: number;
  apparentTemperatureC: number;
  windSpeedKmh: number;
};

type FetchWeatherOptions = {
  timeoutMs?: number;
};

const geocodingResultSchema = z.object({
  name: z.string(),
  country: z.string().optional().default(""),
  admin1: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
});

const geocodingResponseSchema = z.object({
  results: z.array(geocodingResultSchema).optional(),
});

const forecastResponseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
  }),
});

const WEATHER_REQUEST_TIMEOUT_MS = 5_000;
const COUNTRY_ALIASES = new Map([
  ["us", "united states"],
  ["usa", "united states"],
  ["u.s.", "united states"],
  ["u.s.a.", "united states"],
  ["uk", "united kingdom"],
  ["u.k.", "united kingdom"],
  ["au", "australia"],
]);
const REGION_ALIASES_BY_COUNTRY: Record<string, Record<string, string>> = {
  australia: {
    wa: "western australia",
    nsw: "new south wales",
    vic: "victoria",
    qld: "queensland",
    sa: "south australia",
    tas: "tasmania",
    nt: "northern territory",
    act: "australian capital territory",
  },
  "united states": {
    wa: "washington",
    ca: "california",
    ny: "new york",
    tx: "texas",
  },
};

function describeWeatherCode(code: number) {
  switch (code) {
    case 0:
      return "Clear sky";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
      return "Drizzle";
    case 56:
    case 57:
      return "Freezing drizzle";
    case 61:
    case 63:
    case 65:
      return "Rain";
    case 66:
    case 67:
      return "Freezing rain";
    case 71:
    case 73:
    case 75:
      return "Snow fall";
    case 77:
      return "Snow grains";
    case 80:
    case 81:
    case 82:
      return "Rain showers";
    case 85:
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
    case 99:
      return "Thunderstorm with hail";
    default:
      return `Unknown weather code (${code})`;
  }
}

function normalizeLocationPart(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeCountry(value: string) {
  const normalized = normalizeLocationPart(value);
  return COUNTRY_ALIASES.get(normalized) ?? normalized;
}

function normalizeRegion(value: string, country: string | undefined) {
  const normalized = normalizeLocationPart(value);
  if (!country) {
    return normalized;
  }

  return (
    REGION_ALIASES_BY_COUNTRY[normalizeCountry(country)]?.[normalized] ??
    normalized
  );
}

function matchesCountry(
  candidate: string | undefined,
  expected: string | undefined,
) {
  if (!expected) {
    return true;
  }

  if (!candidate) {
    return false;
  }

  return normalizeCountry(candidate) === normalizeCountry(expected);
}

function matchesRegion(
  candidate: string | undefined,
  expected: string | undefined,
  country: string | undefined,
) {
  if (!expected) {
    return true;
  }

  if (!candidate) {
    return false;
  }

  return normalizeRegion(candidate, country) === normalizeRegion(expected, country);
}

function formatLocationOption(location: z.infer<typeof geocodingResultSchema>) {
  return [location.name, location.admin1, location.country]
    .filter(Boolean)
    .join(", ");
}

function selectLocationMatch(
  query: WeatherInput,
  results: z.infer<typeof geocodingResultSchema>[],
): z.infer<typeof geocodingResultSchema> {
  const exactCityMatches = results.filter(
    (result) =>
      normalizeLocationPart(result.name) === normalizeLocationPart(query.city),
  );

  if (exactCityMatches.length === 0) {
    const suggestions = results.slice(0, 3).map(formatLocationOption).join(" | ");
    const suggestionSuffix = suggestions ? ` Similar matches: ${suggestions}` : "";
    throw new ToolError(
      "clarification_required",
      `Could not find an exact city match for "${query.city}". Check the spelling or use the exact city name.${suggestionSuffix}`,
    );
  }

  const narrowedCandidates = exactCityMatches.filter(
    (result) =>
      matchesRegion(result.admin1, query.region, result.country || query.country) &&
      matchesCountry(result.country, query.country),
  );

  if (narrowedCandidates.length === 1) {
    const [match] = narrowedCandidates;
    if (match) {
      return match;
    }
  }

  if (narrowedCandidates.length > 1) {
    const options = narrowedCandidates
      .slice(0, 3)
      .map(formatLocationOption)
      .join(" | ");

    throw new ToolError(
      "clarification_required",
      `City lookup is ambiguous for "${query.city}". Be more specific with region or country. Matches: ${options}`,
    );
  }

  if (exactCityMatches.length === 1 && !query.region && !query.country) {
    const [match] = exactCityMatches;
    if (match) {
      return match;
    }
  }

  const exactOptions = exactCityMatches
    .slice(0, 3)
    .map(formatLocationOption)
    .join(" | ");

  throw new ToolError(
    "clarification_required",
    `Could not find a city match for "${query.city}" with the provided region or country. Exact matches: ${exactOptions}`,
  );
}

async function fetchJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  context: ToolContext,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await context.fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ToolError(
        "external_service_error",
        `Weather request timed out after ${timeoutMs}ms`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    throw new ToolError(
      "external_service_error",
      `Weather request failed: ${res.status} ${await res.text()}`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ToolError(
      "external_service_error",
      "Weather provider returned malformed JSON response",
    );
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ToolError(
      "external_service_error",
      "Weather provider returned unexpected response shape",
    );
  }

  return parsed.data;
}

export async function fetchWeatherByCity(
  query: WeatherInput,
  context: ToolContext,
  options: FetchWeatherOptions = {},
): Promise<WeatherResult> {
  const timeoutMs = options.timeoutMs ?? WEATHER_REQUEST_TIMEOUT_MS;
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", query.city);
  geocodingUrl.searchParams.set("count", "10");
  geocodingUrl.searchParams.set("language", "en");
  geocodingUrl.searchParams.set("format", "json");

  const geocoding = await fetchJson(
    geocodingUrl,
    geocodingResponseSchema,
    context,
    timeoutMs,
  );

  const results = geocoding.results ?? [];
  if (results.length === 0) {
    throw new ToolError(
      "clarification_required",
      `Could not find weather data for city: ${query.city}`,
    );
  }

  const match = selectLocationMatch(query, results);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(match.latitude));
  forecastUrl.searchParams.set("longitude", String(match.longitude));
  forecastUrl.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
  );
  forecastUrl.searchParams.set("timezone", "auto");

  const forecast = await fetchJson(
    forecastUrl,
    forecastResponseSchema,
    context,
    timeoutMs,
  );

  return {
    city: match.name,
    region: match.admin1 ?? null,
    country: match.country,
    timezone: match.timezone,
    forecast: describeWeatherCode(forecast.current.weather_code),
    temperatureC: forecast.current.temperature_2m,
    apparentTemperatureC: forecast.current.apparent_temperature,
    windSpeedKmh: forecast.current.wind_speed_10m,
  };
}
