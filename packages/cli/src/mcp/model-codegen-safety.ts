const PHP_RESERVED_WORDS = new Set([
  "abstract",
  "and",
  "array",
  "as",
  "break",
  "callable",
  "case",
  "catch",
  "class",
  "clone",
  "const",
  "continue",
  "declare",
  "default",
  "die",
  "do",
  "echo",
  "else",
  "elseif",
  "empty",
  "enddeclare",
  "endfor",
  "endforeach",
  "endif",
  "endswitch",
  "endwhile",
  "enum",
  "eval",
  "exit",
  "extends",
  "final",
  "finally",
  "fn",
  "for",
  "foreach",
  "function",
  "global",
  "goto",
  "if",
  "implements",
  "include",
  "include_once",
  "instanceof",
  "insteadof",
  "interface",
  "isset",
  "list",
  "match",
  "namespace",
  "new",
  "or",
  "print",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "require_once",
  "return",
  "static",
  "switch",
  "throw",
  "trait",
  "try",
  "unset",
  "use",
  "var",
  "while",
  "xor",
  "yield",
]);

const PYTHON_RESERVED_WORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "false",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "none",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "true",
  "try",
  "while",
  "with",
  "yield",
]);

export function allocatePhpClassIdentifiers(values: string[]): string[] {
  return allocateIdentifiers(values, (value) =>
    safePascalIdentifier(singularize(value), "Model", PHP_RESERVED_WORDS),
  );
}

export function allocatePhpMethodIdentifiers(values: string[]): string[] {
  return allocateIdentifiers(values, (value) =>
    safeCamelIdentifier(value, "relation", PHP_RESERVED_WORDS),
  );
}

export function allocatePythonClassIdentifiers(values: string[]): string[] {
  return allocateIdentifiers(values, (value) =>
    safePascalIdentifier(singularize(value), "Model", PYTHON_RESERVED_WORDS),
  );
}

export function allocatePythonAttributeIdentifiers(values: string[]): string[] {
  return allocateIdentifiers(values, (value) =>
    safeSnakeIdentifier(value, "field", PYTHON_RESERVED_WORDS),
  );
}

export function phpStringLiteral(value: string): string {
  return `"${[...value]
    .map((character) => {
      const codePoint = character.codePointAt(0)!;
      if (codePoint <= 0x1f || codePoint === 0x7f) {
        return `\\x${codePoint.toString(16).padStart(2, "0")}`;
      }
      switch (character) {
        case "\\":
          return "\\\\";
        case '"':
          return '\\"';
        case "$":
          return "\\$";
        default:
          return character;
      }
    })
    .join("")}"`;
}

export function pythonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

export function syntaxValidationMetadata(language: "php" | "python"): Record<string, unknown> {
  return {
    language,
    templateValidated: true,
    identifiersValidated: true,
    literalsEscaped: true,
    runtimeSyntaxCheck: "not_run",
  };
}

function allocateIdentifiers(values: string[], encode: (value: string) => string): string[] {
  const used = new Set<string>();
  return values.map((value) => {
    const base = encode(value);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    const suffix = stableSuffix(value);
    let candidate = `${base}_${suffix}`;
    let collisionIndex = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}_${collisionIndex}`;
      collisionIndex += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function safePascalIdentifier(value: string, prefix: string, reserved: Set<string>): string {
  const words = identifierWords(value);
  let identifier = words.map(capitalize).join("") || prefix;
  if (/^[0-9]/.test(identifier) || reserved.has(identifier.toLocaleLowerCase("en-US"))) {
    identifier = `${prefix}${capitalize(identifier)}`;
  }
  return identifier;
}

function safeCamelIdentifier(value: string, prefix: string, reserved: Set<string>): string {
  const words = identifierWords(value);
  let identifier = words.length
    ? `${words[0]!.toLocaleLowerCase("en-US")}${words.slice(1).map(capitalize).join("")}`
    : prefix;
  if (/^[0-9]/.test(identifier) || reserved.has(identifier.toLocaleLowerCase("en-US"))) {
    identifier = `${prefix}${capitalize(identifier)}`;
  }
  return identifier;
}

function safeSnakeIdentifier(value: string, prefix: string, reserved: Set<string>): string {
  const words = identifierWords(value);
  let identifier = words.join("_") || prefix;
  if (/^[0-9]/.test(identifier) || reserved.has(identifier.toLocaleLowerCase("en-US"))) {
    identifier = `${prefix}_${identifier}`;
  }
  return identifier;
}

function identifierWords(value: string): string[] {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  const words: string[] = [];
  let ascii = "";
  const flushAscii = () => {
    if (ascii) {
      words.push(ascii.toLocaleLowerCase("en-US"));
      ascii = "";
    }
  };
  for (const character of expanded) {
    if (/[A-Za-z0-9]/.test(character)) {
      ascii += character;
      continue;
    }
    flushAscii();
    if (character.codePointAt(0)! > 0x7f) {
      words.push(`u${character.codePointAt(0)!.toString(16)}`);
    }
  }
  flushAscii();
  return words;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toLocaleUpperCase("en-US") + value.slice(1);
}

function stableSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function singularize(value: string): string {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}
