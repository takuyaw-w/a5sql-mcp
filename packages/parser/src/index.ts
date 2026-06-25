import type {
  ParsedA5erColumn,
  ParsedA5erDocument,
  ParsedA5erIndex,
  ParsedA5erPosition,
  ParsedA5erRelationship,
  ParsedA5erTable
} from "./types.js";

type A5erSection = {
  name: string;
  entries: Map<string, string[]>;
};

export function parseA5erIni(text: string): ParsedA5erDocument {
  const normalized = text.replace(/^\uFEFF/, "");
  const warnings: string[] = [];
  const sections = parseSections(normalized);
  const header = parseHeader(normalized);
  const managerSection = sections.find((section) => equalsIgnoreCase(section.name, "Manager"));
  const manager = managerSection ? parseManager(managerSection) : {};
  if (!managerSection) {
    warnings.push("manager_section_not_found");
  }

  const tables = sections
    .filter((section) => equalsAnyIgnoreCase(section.name, ["Entity", "View"]))
    .map(parseTable)
    .filter((table): table is ParsedA5erTable => table !== null);

  const relationships = sections
    .filter((section) => equalsAnyIgnoreCase(section.name, ["Relation", "Relationship"]))
    .map(parseRelationship)
    .filter((relationship): relationship is ParsedA5erRelationship => relationship !== null);

  return {
    formatVersion: header.formatVersion,
    encoding: header.encoding,
    manager,
    tables,
    relationships,
    warnings
  };
}

function parseHeader(text: string): { formatVersion?: number; encoding?: string } {
  const formatMatch = text.match(/^\s*#\s*A5:ER\s+FORMAT\s*:\s*(\d+)/im);
  const encodingMatch = text.match(/^\s*#\s*A5:ER\s+ENCODING\s*:\s*([A-Za-z0-9_-]+)/im);
  return {
    formatVersion: formatMatch?.[1] ? Number(formatMatch[1]) : undefined,
    encoding: encodingMatch?.[1]
  };
}

function parseSections(text: string): A5erSection[] {
  const sections: A5erSection[] = [];
  let current: A5erSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      current = { name: sectionMatch[1]!.trim(), entries: new Map() };
      sections.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const values = current.entries.get(key) ?? [];
    values.push(value);
    current.entries.set(key, values);
  }

  return sections;
}

function parseManager(section: A5erSection): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, values] of section.entries.entries()) {
    if (key === "PageInfo" || key === "DomainInfo" || key === "CommonField") {
      result[key] = values.map(parseComplexValue);
      continue;
    }
    result[key] = values.length === 1 ? parseScalar(values[0]!) : values.map(parseScalar);
  }
  return result;
}

function parseTable(section: A5erSection): ParsedA5erTable | null {
  const physicalName = first(section, "PName");
  const logicalName = first(section, "LName");
  const name = physicalName ?? logicalName;
  if (!name) {
    return null;
  }

  const columns = all(section, "Field").map(parseField);
  return {
    objectType: equalsIgnoreCase(section.name, "View") ? "view" : "entity",
    name,
    physicalName,
    logicalName,
    comment: decodeEscaped(first(section, "Comment")),
    columns,
    indexes: all(section, "Index").map(parseIndex),
    positions: all(section, "Position").map(parsePosition).filter((item): item is ParsedA5erPosition => item !== null)
  };
}

function parseField(value: string): ParsedA5erColumn {
  const parts = parseComplexValue(value).map(stringifyComplexPart);
  const keyOrder = toNumber(parts[4]);
  return {
    name: parts[1] || parts[0] || "unknown_column",
    logicalName: emptyToUndefined(parts[0]),
    physicalName: emptyToUndefined(parts[1]),
    dataType: emptyToUndefined(parts[2]),
    nullable: parts[3]?.toLocaleUpperCase() === "NOT NULL" ? false : undefined,
    primaryKey: keyOrder !== undefined,
    keyOrder,
    defaultValue: emptyToUndefined(parts[5]),
    comment: emptyToUndefined(parts[6]),
    option: emptyToUndefined(parts[8])
  };
}

function parseIndex(value: string): ParsedA5erIndex {
  const separator = value.indexOf("=");
  const name = separator >= 0 ? value.slice(0, separator) : undefined;
  const rest = separator >= 0 ? value.slice(separator + 1) : value;
  const parts = parseComplexValue(rest).map(stringifyComplexPart);
  const uniqueType = Number(parts[0] ?? 0);
  return {
    name: emptyToUndefined(name),
    unique: uniqueType === 1 || uniqueType === 2,
    uniqueType: Number.isFinite(uniqueType) ? uniqueType : 0,
    columns: parts.slice(1).filter(Boolean)
  };
}

function parsePosition(value: string): ParsedA5erPosition | null {
  const parts = parseComplexValue(value).map(stringifyComplexPart);
  if (!parts[0]) {
    return null;
  }
  return {
    page: parts[0],
    x: toNumber(parts[1]),
    y: toNumber(parts[2]),
    width: toNumber(parts[3]),
    height: toNumber(parts[4])
  };
}

function parseRelationship(section: A5erSection): ParsedA5erRelationship | null {
  const entity1 = first(section, "Entity1");
  const entity2 = first(section, "Entity2");
  if (!entity1 && !entity2) {
    return null;
  }
  return {
    name: emptyToUndefined(first(section, "PName")),
    entity1,
    entity2,
    fields1: splitList(first(section, "Fields1")),
    fields2: splitList(first(section, "Fields2")),
    relationType1: toNumber(first(section, "RelationType1")),
    relationType2: toNumber(first(section, "RelationType2")),
    caption: emptyToUndefined(first(section, "Caption"))
  };
}

export function parseComplexValue(value: string): unknown[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quoted && char === "\\") {
      const next = value[index + 1];
      if (next) {
        current += decodeEscape(next);
        index += 1;
        continue;
      }
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result.map(parseScalar);
}

function parseScalar(value: string): unknown {
  const decoded = decodeEscaped(value.trim().replace(/^"|"$/g, "")) ?? "";
  if (decoded === "") {
    return "";
  }
  if (/^-?\d+$/.test(decoded)) {
    return Number(decoded);
  }
  if (/^-?\d+\.\d+$/.test(decoded)) {
    return Number(decoded);
  }
  return decoded;
}

function decodeEscaped(value: string | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  return value.replace(/\\(.)/g, (_match, escaped: string) => decodeEscape(escaped));
}

function decodeEscape(value: string): string {
  switch (value) {
    case "\\":
      return "\\";
    case "Q":
      return "\"";
    case "q":
      return "'";
    case "t":
      return "\t";
    case "n":
      return "\n";
    default:
      return value;
  }
}

function first(section: A5erSection, key: string): string | undefined {
  return section.entries.get(key)?.[0];
}

function all(section: A5erSection, key: string): string[] {
  return section.entries.get(key) ?? [];
}

function splitList(value: string | undefined): string[] {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function stringifyComplexPart(value: unknown): string {
  return value == null ? "" : String(value);
}

function toNumber(value: string | undefined): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

function equalsAnyIgnoreCase(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => equalsIgnoreCase(value, candidate));
}

export type {
  ParsedA5erColumn,
  ParsedA5erDocument,
  ParsedA5erIndex,
  ParsedA5erPosition,
  ParsedA5erRelationship,
  ParsedA5erTable
} from "./types.js";
export { parseSqlStatements } from "./sql.js";
export type { ParsedSqlStatement } from "./sql.js";
