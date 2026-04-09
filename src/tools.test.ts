import { expect, test } from "bun:test";

import { createToolContext } from "./tools/base";
import { fetchWeatherByCity } from "./tools/weather/service";
import { getWeatherTool } from "./tools/weather/tool";

test("fetches current weather for a city", async () => {
  const calls: string[] = [];
  const fetchMock = (async (input, init) => {
    expect(init?.signal).toBeDefined();
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Berlin",
              country: "Germany",
              admin1: "Berlin",
              latitude: 52.52437,
              longitude: 13.41053,
              timezone: "Europe/Berlin",
            },
          ],
        }),
      );
    }

    if (url.startsWith("https://api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 13.2,
            apparent_temperature: 11.8,
            weather_code: 63,
            wind_speed_10m: 18.4,
          },
        }),
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Berlin", country: "Germany" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).resolves.toEqual({
    city: "Berlin",
    region: "Berlin",
    country: "Germany",
    timezone: "Europe/Berlin",
    forecast: "Rain",
    temperatureC: 13.2,
    apparentTemperatureC: 11.8,
    windSpeedKmh: 18.4,
  });

  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("name=Berlin");
  expect(calls[1]).toContain("latitude=52.52437");
  expect(calls[1]).toContain("longitude=13.41053");
  expect(calls[1]).toContain("current=temperature_2m%2Capparent_temperature%2Cweather_code%2Cwind_speed_10m");
});

test("surfaces a useful error when the city cannot be resolved", async () => {
  const fetchMock = (async () =>
    new Response(JSON.stringify({ results: [] }))) as unknown as typeof fetch;

  await expect(
    fetchWeatherByCity({ city: "Xy" }, createToolContext({ fetch: fetchMock })),
  ).rejects.toThrow(
    "Could not find weather data for city: Xy",
  );
});

test("rejects ambiguous city matches without more context", async () => {
  const fetchMock = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            name: "Perth",
            country: "Australia",
            admin1: "Western Australia",
            latitude: -31.9522,
            longitude: 115.8589,
            timezone: "Australia/Perth",
          },
          {
            name: "Perth",
            country: "United Kingdom",
            admin1: "Scotland",
            latitude: 56.3952,
            longitude: -3.4314,
            timezone: "Europe/London",
          },
        ],
      }),
    )) as unknown as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Perth" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).rejects.toThrow(
    'City lookup is ambiguous for "Perth". Be more specific with region or country.',
  );
});

test("does not fall back to fuzzy geocoder matches", async () => {
  const fetchMock = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "London",
              country: "United Kingdom",
              admin1: "England",
              latitude: 51.5085,
              longitude: -0.1257,
              timezone: "Europe/London",
            },
          ],
        }),
      );
    }

    throw new Error("Forecast should not be requested without an exact city match");
  }) as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Londen", country: "United Kingdom" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).rejects.toThrow(
    'Could not find an exact city match for "Londen".',
  );
});

test("uses exact city match narrowed by country", async () => {
  const calls: string[] = [];
  const fetchMock = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Perth",
              country: "Australia",
              admin1: "Western Australia",
              latitude: -31.9522,
              longitude: 115.8589,
              timezone: "Australia/Perth",
            },
            {
              name: "Perth",
              country: "United Kingdom",
              admin1: "Scotland",
              latitude: 56.3952,
              longitude: -3.4314,
              timezone: "Europe/London",
            },
          ],
        }),
      );
    }

    if (url.startsWith("https://api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 24,
            apparent_temperature: 26,
            weather_code: 0,
            wind_speed_10m: 12,
          },
        }),
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Perth", country: "Australia" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).resolves.toEqual({
    city: "Perth",
    region: "Western Australia",
    country: "Australia",
    timezone: "Australia/Perth",
    forecast: "Clear sky",
    temperatureC: 24,
    apparentTemperatureC: 26,
    windSpeedKmh: 12,
  });

  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain("latitude=-31.9522");
  expect(calls[1]).toContain("longitude=115.8589");
});

test("normalizes common country and region aliases", async () => {
  const fetchMock = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Perth",
              country: "Australia",
              admin1: "Western Australia",
              latitude: -31.9522,
              longitude: 115.8589,
              timezone: "Australia/Perth",
            },
            {
              name: "Perth",
              country: "United Kingdom",
              admin1: "Scotland",
              latitude: 56.3952,
              longitude: -3.4314,
              timezone: "Europe/London",
            },
          ],
        }),
      );
    }

    if (url.startsWith("https://api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 24,
            apparent_temperature: 26,
            weather_code: 0,
            wind_speed_10m: 12,
          },
        }),
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Perth", region: "WA", country: "AU" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).resolves.toEqual({
    city: "Perth",
    region: "Western Australia",
    country: "Australia",
    timezone: "Australia/Perth",
    forecast: "Clear sky",
    temperatureC: 24,
    apparentTemperatureC: 26,
    windSpeedKmh: 12,
  });
});

test("lists exact city matches when region or country filters miss", async () => {
  const fetchMock = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            name: "Perth",
            country: "Australia",
            admin1: "Western Australia",
            latitude: -31.9522,
            longitude: 115.8589,
            timezone: "Australia/Perth",
          },
          {
            name: "Perth",
            country: "United Kingdom",
            admin1: "Scotland",
            latitude: 56.3952,
            longitude: -3.4314,
            timezone: "Europe/London",
          },
        ],
      }),
    )) as unknown as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Perth", country: "Canada" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).rejects.toThrow(
    "Exact matches: Perth, Western Australia, Australia | Perth, Scotland, United Kingdom",
  );
});

test("returns a stable error for malformed JSON from provider", async () => {
  const fetchMock = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Berlin",
              country: "Germany",
              admin1: "Berlin",
              latitude: 52.52437,
              longitude: 13.41053,
              timezone: "Europe/Berlin",
            },
          ],
        }),
      );
    }

    if (url.startsWith("https://api.open-meteo.com/")) {
      return new Response("not-json", {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Berlin", country: "Germany" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).rejects.toThrow("Weather provider returned malformed JSON response");
});

test("returns a stable error for unexpected provider payload shape", async () => {
  const fetchMock = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            name: "Berlin",
            country: "Germany",
          },
        ],
      }),
    )) as unknown as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Berlin", country: "Germany" },
      createToolContext({ fetch: fetchMock }),
    ),
  ).rejects.toThrow("Weather provider returned unexpected response shape");
});

test("times out slow weather requests", async () => {
  const fetchMock = ((_, init) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as typeof fetch;

  await expect(
    fetchWeatherByCity(
      { city: "Berlin" },
      createToolContext({ fetch: fetchMock }),
      { timeoutMs: 1 },
    ),
  ).rejects.toThrow("Weather request timed out after 1ms");
});

test("tool schema expects a city argument", async () => {
  expect(getWeatherTool.schema.parse({ city: "Perth" })).toEqual({
    city: "Perth",
  });
  expect(
    getWeatherTool.schema.parse({
      city: "Perth",
      region: "Western Australia",
      country: "Australia",
    }),
  ).toEqual({
    city: "Perth",
    region: "Western Australia",
    country: "Australia",
  });
  expect(
    getWeatherTool.schema.parse({
      city: "Perth",
      region: "WA",
      country: "AU",
    }),
  ).toEqual({
    city: "Perth",
    region: "WA",
    country: "AU",
  });
});
