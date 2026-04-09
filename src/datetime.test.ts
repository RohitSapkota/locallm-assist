import { expect, test } from "bun:test";

import { getCurrentDateTime } from "./tools/datetime/service";
import { getDateTimeTool } from "./tools/datetime/tool";

test("returns current datetime in the requested timezone", () => {
  const fixedNow = new Date("2026-04-09T13:14:15.000Z");

  expect(
    getCurrentDateTime(
      { timeZone: "Australia/Perth" },
      { now: fixedNow, defaultTimeZone: "UTC" },
    ),
  ).toEqual({
    timeZone: "Australia/Perth",
    isoUtc: "2026-04-09T13:14:15.000Z",
    date: "2026-04-09",
    time: "21:14:15",
    dateTime: "2026-04-09T21:14:15",
    unixMs: fixedNow.getTime(),
  });
});

test("falls back to the default timezone when none is requested", () => {
  const fixedNow = new Date("2026-04-09T13:14:15.000Z");

  expect(
    getCurrentDateTime({}, { now: fixedNow, defaultTimeZone: "UTC" }),
  ).toEqual({
    timeZone: "UTC",
    isoUtc: "2026-04-09T13:14:15.000Z",
    date: "2026-04-09",
    time: "13:14:15",
    dateTime: "2026-04-09T13:14:15",
    unixMs: fixedNow.getTime(),
  });
});

test("rejects invalid timezone inputs with a stable error", () => {
  expect(() =>
    getCurrentDateTime(
      { timeZone: "Mars/OlympusMons" },
      { now: new Date("2026-04-09T13:14:15.000Z"), defaultTimeZone: "UTC" },
    ),
  ).toThrow(
    'Invalid timeZone: Mars/OlympusMons. Use an IANA timezone like "UTC" or "Australia/Perth".',
  );
});

test("tool schema accepts an optional timezone argument", () => {
  expect(getDateTimeTool.schema.parse({})).toEqual({});
  expect(getDateTimeTool.schema.parse({ timeZone: "UTC" })).toEqual({
    timeZone: "UTC",
  });
});
