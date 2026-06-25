export type ParsedSqlStatement = {
  index: number;
  operation: string;
  preview: string;
  referencedTables: string[];
};

export function parseSqlStatements(text: string): ParsedSqlStatement[] {
  return splitSqlStatements(text)
    .slice(0, 100)
    .map((statement, index) => ({
      index,
      operation: detectOperation(statement),
      preview: statement.replace(/\s+/g, " ").trim().slice(0, 240),
      referencedTables: detectReferencedTables(statement)
    }));
}

function splitSqlStatements(text: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | "\"" | "`" | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if ((char === "'" || char === "\"" || char === "`") && previous !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === ";" && quote === null) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    statements.push(current.trim());
  }
  return statements;
}

function detectOperation(statement: string): string {
  const match = statement.match(/^\s*(select|insert|update|delete|merge|create|alter|drop|with)\b/i);
  return match?.[1]?.toLocaleLowerCase() ?? "unknown";
}

function detectReferencedTables(statement: string): string[] {
  const tables = new Set<string>();
  const patterns = [
    /\bfrom\s+([A-Za-z0-9_."]+)/gi,
    /\bjoin\s+([A-Za-z0-9_."]+)/gi,
    /\binto\s+([A-Za-z0-9_."]+)/gi,
    /\bupdate\s+([A-Za-z0-9_."]+)/gi
  ];
  for (const pattern of patterns) {
    for (const match of statement.matchAll(pattern)) {
      if (match[1]) {
        tables.add(match[1].replace(/^"|"$/g, ""));
      }
    }
  }
  return [...tables].sort();
}
