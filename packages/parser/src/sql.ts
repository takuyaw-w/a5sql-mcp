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
  const source = stripSqlNonCodeText(statement);
  const match = source.match(
    /^\s*(select|insert|update|delete|merge|create|alter|drop|with)\b/i,
  );
  return match?.[1]?.toLocaleLowerCase() ?? "unknown";
}

function stripSqlNonCodeText(statement: string): string {
  let stripped = "";
  let quote: "'" | '"' | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index] ?? "";
    const next = statement[index + 1];

    if (dollarQuoteTag) {
      if (statement.startsWith(dollarQuoteTag, index)) {
        stripped += maskSqlNonCodeText(dollarQuoteTag);
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        stripped += maskSqlNonCodeChar(char);
      }
      continue;
    }

    if (inLineComment) {
      stripped += maskSqlNonCodeChar(char);
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      stripped += maskSqlNonCodeChar(char);
      if (char === "*" && next === "/") {
        stripped += maskSqlNonCodeChar(next);
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      stripped += maskSqlNonCodeChar(char);
      if (char === quote) {
        if (next === quote) {
          stripped += maskSqlNonCodeChar(next);
          index += 1;
          continue;
        }
        if (!isBackslashEscaped(statement, index)) {
          quote = null;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      stripped += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      stripped += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    const dollarQuoteMatch = statement.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (dollarQuoteMatch?.[0]) {
      dollarQuoteTag = dollarQuoteMatch[0];
      stripped += maskSqlNonCodeText(dollarQuoteTag);
      index += dollarQuoteTag.length - 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      stripped += " ";
      continue;
    }

    stripped += char;
  }

  return stripped;
}

function maskSqlNonCodeText(text: string): string {
  return [...text].map(maskSqlNonCodeChar).join("");
}

function maskSqlNonCodeChar(char: string | undefined): string {
  return char === "\n" || char === "\r" ? char : " ";
}

function detectReferencedTables(statement: string): string[] {
  const source = stripSqlNonCodeText(statement);
  const tables = new Set<string>();
  const patterns = [
    /\bfrom\s+([A-Za-z0-9_."]+)/gi,
    /\bjoin\s+([A-Za-z0-9_."]+)/gi,
    /\binto\s+([A-Za-z0-9_."]+)/gi,
    /\bupdate\s+([A-Za-z0-9_."]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        tables.add(match[1].replace(/^"|"$/g, ""));
      }
    }
  }
  return [...tables].sort();
}
