import { ToolError } from "../base";

export type DateTimeInput = {
  timeZone?: string;
};

export type DateTimeResult = {
  timeZone: string;
  isoUtc: string;
  date: string;
  time: string;
  dateTime: string;
  unixMs: number;
};

type GetCurrentDateTimeOptions = {
  now?: Date;
  defaultTimeZone?: string;
};

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function resolveTimeZone(
  requestedTimeZone: string | undefined,
  defaultTimeZone: string,
) {
  const trimmed = requestedTimeZone?.trim();
  const timeZone = trimmed || defaultTimeZone;

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    throw new ToolError(
      "validation_error",
      `Invalid timeZone: ${timeZone}. Use an IANA timezone like "UTC" or "Australia/Perth".`,
    );
  }
}

function formatInTimeZone(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);

  const date = `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(parts, "day")}`;
  const time = `${getPart(parts, "hour")}:${getPart(parts, "minute")}:${getPart(parts, "second")}`;

  return {
    date,
    time,
    dateTime: `${date}T${time}`,
  };
}

export function getCurrentDateTime(
  input: DateTimeInput,
  options: GetCurrentDateTimeOptions = {},
): DateTimeResult {
  const now = options.now ?? new Date();
  const defaultTimeZone =
    options.defaultTimeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  const timeZone = resolveTimeZone(input.timeZone, defaultTimeZone);
  const formatted = formatInTimeZone(now, timeZone);

  return {
    timeZone,
    isoUtc: now.toISOString(),
    date: formatted.date,
    time: formatted.time,
    dateTime: formatted.dateTime,
    unixMs: now.getTime(),
  };
}
