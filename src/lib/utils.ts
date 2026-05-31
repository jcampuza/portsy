import type { PortEntry, PortRange } from "./types";

export function formatProcessNames(names: string[]) {
  return names.join(", ");
}

export function parseProcessNames(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function getEntryDisplayName(entry: PortEntry) {
  const commandName = displayNameFromCommand(entry.command, entry.processName);
  return commandName || entry.processName;
}

function displayNameFromCommand(command: string, processName: string) {
  const appName = appNameFromPath(command);
  if (appName) return appName;

  const tokens = tokenizeCommand(command);
  for (const token of tokens) {
    const tokenAppName = appNameFromPath(token);
    if (tokenAppName) return tokenAppName;
  }

  for (const token of tokens) {
    if (!token.startsWith("/") && !token.startsWith("~/")) continue;
    const name = nameFromProjectPath(token, processName);
    if (name) return name;
  }

  return null;
}

function tokenizeCommand(command: string) {
  return (
    command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? []
  );
}

function appNameFromPath(path: string) {
  const match = path.match(/\/([^/]+)\.app(?:\/|$)/);
  return match ? match[1] : null;
}

function nameFromProjectPath(path: string, processName: string) {
  const parts = path.split("/").filter(Boolean);
  const nodeModulesIndex = parts.indexOf("node_modules");
  if (nodeModulesIndex > 0) {
    return humanizePathSegment(parts[nodeModulesIndex - 1]);
  }

  const last = parts.at(-1);
  if (!last || last === processName || last.includes(".")) {
    const parent = parts.at(-2);
    return parent ? humanizePathSegment(parent) : null;
  }
  return humanizePathSegment(last);
}

function humanizePathSegment(segment: string) {
  return segment
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatRanges(ranges: PortRange[]) {
  return ranges
    .map((range) =>
      range.start === range.end ? String(range.start) : `${range.start}-${range.end}`,
    )
    .join(", ");
}

export function parseRanges(value: string): PortRange[] {
  const ranges = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map((item) => Number(item.trim()));
        return validateRange(start, end);
      }
      const port = Number(part);
      return validateRange(port, port);
    });

  if (ranges.length === 0) {
    throw new Error("Add at least one watched port range.");
  }
  return ranges;
}

function validateRange(start: number, end: number): PortRange {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end > 65535 ||
    start > end
  ) {
    throw new Error("Port ranges must be between 1 and 65535.");
  }
  return { start, end };
}
