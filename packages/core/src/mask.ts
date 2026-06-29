const KEY_VALUE_SECRET =
  /\b([A-Za-z0-9_. -]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_. -]*)\b(\s*[:=]\s*|=)(["']?)([^;"'\r\n<>&]+)(["']?)/gi;

const KEYED_CONNECTION_STRING =
  /\b(database_url|dsn|connection_string|jdbc_url|odbc_connection_string|conn_string|connect_string)\b(\s*[:=]\s*)(["']?)([^\r\n]*)/gi;
const URL_USERINFO_PASSWORD = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^@\s/?#]+:[^@\s/?#]*)@/g;
const XML_SECRET =
  /<([A-Za-z0-9_.:-]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_.:-]*)([^>]*)>([^<]*)<\/\1>/gi;

const CONNECTION_STRING_SECRET = /\b(password|pwd)(\s*=\s*)(["']?)([^;"'\r\n]+)(["']?)/gi;
const PEM_PRIVATE_KEY = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;

export function maskSensitiveText(input: string): string {
  return input
    .replace(KEYED_CONNECTION_STRING, (_match, key, separator, openQuote, value) => {
      const closeQuote = openQuote && value.endsWith(openQuote) ? openQuote : "";
      return `${key}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(KEY_VALUE_SECRET, (_match, key, separator, openQuote, _value, closeQuote) => {
      return `${key}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(XML_SECRET, (_match, key, attrs) => `<${key}${attrs}>***</${key}>`)
    .replace(CONNECTION_STRING_SECRET, (_match, key, separator, openQuote, _value, closeQuote) => {
      return `${key}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(URL_USERINFO_PASSWORD, (_match, prefix) => `${prefix}***@`)
    .replace(PEM_PRIVATE_KEY, (_match, label) => {
      return `-----BEGIN ${label}-----\n***\n-----END ${label}-----`;
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
  return /password|passwd|pwd|pass|secret|token|api[_-]?key|private[_-]?key/i.test(key);
}
