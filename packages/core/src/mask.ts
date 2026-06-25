const KEY_VALUE_SECRET =
  /\b(password|passwd|pwd|pass|secret|token|access_token|refresh_token|api[_-]?key)\b(\s*[:=]\s*|=)(["']?)([^;"'\r\n<>&]+)(["']?)/gi;

const XML_SECRET =
  /<(password|passwd|pwd|pass|secret|token|access_token|refresh_token|api[_-]?key)([^>]*)>([^<]*)<\/\1>/gi;

const CONNECTION_STRING_SECRET =
  /\b(password|pwd)(\s*=\s*)(["']?)([^;"'\r\n]+)(["']?)/gi;

export function maskSensitiveText(input: string): string {
  return input
    .replace(KEY_VALUE_SECRET, (_match, key, separator, openQuote, _value, closeQuote) => {
      return `${key}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(XML_SECRET, (_match, key, attrs) => `<${key}${attrs}>***</${key}>`)
    .replace(CONNECTION_STRING_SECRET, (_match, key, separator, openQuote, _value, closeQuote) => {
      return `${key}${separator}${openQuote}***${closeQuote}`;
    });
}

export function maskValue(value: string | undefined, reveal: boolean): string | null {
  if (value == null || value.length === 0) {
    return null;
  }
  if (reveal) {
    return value;
  }
  if (value.length <= 2) {
    return "***";
  }
  return `${value.slice(0, 1)}***${value.slice(-1)}`;
}

export function hasSecretLikeKey(key: string): boolean {
  return /password|passwd|pwd|pass|secret|token|api[_-]?key/i.test(key);
}
