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
      referencedTables: detectReferencedTables(statement),
    }));
}

function splitSqlStatements(text: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (dollarQuoteTag) {
      if (text.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (inLineComment) {
      current += char;
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
          continue;
        }
        if (!isBackslashEscaped(text, index)) {
          quote = null;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += char + next;
      index += 1;
      inBlockComment = true;
      continue;
    }

    const dollarQuoteMatch = text.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (dollarQuoteMatch?.[0]) {
      dollarQuoteTag = dollarQuoteMatch[0];
      current += dollarQuoteTag;
      index += dollarQuoteTag.length - 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
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

function isBackslashEscaped(text: string, quoteIndex: number): boolean {
  let slashCount = 0;
  for (let index = quoteIndex - 1; text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function detectOperation(statement: string): string {
  const match = statement.match(
    /^\s*(select|insert|update|delete|merge|create|alter|drop|with)\b/i,
  );
  return match?.[1]?.toLocaleLowerCase() ?? "unknown";
}

function detectReferencedTables(statement: string): string[] {
  const tables = new Set<string>();
  const patterns = [
    /\bfrom\s+([A-Za-z0-9_."]+)/gi,
    /\bjoin\s+([A-Za-z0-9_."]+)/gi,
    /\binto\s+([A-Za-z0-9_."]+)/gi,
    /\bupdate\s+([A-Za-z0-9_."]+)/gi,
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
