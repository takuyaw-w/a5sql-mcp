const KEY_VALUE_SECRET =
  /\b([A-Za-z0-9_. -]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_. -]*)\b(\s*[:=]\s*|=)(["']?)([^;"'\r\n<>&]+)(["']?)/gi;

const QUOTED_KEY_VALUE_SECRET =
  /(["'])([A-Za-z0-9_. -]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_. -]*)\1(\s*:\s*)(["'])(?:\\.|(?!\4)[^"\\\r\n])*\4/gi;

const EXPORT_KEY_VALUE_SECRET =
  /\b(export\s+)([A-Za-z0-9_. -]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_. -]*)(\s*=\s*)(?:((["']))(?:\\.|(?!\4)[^"\\\r\n<>]*)\4|([^"'\r\n<>]+))/gi;

const AUTHORIZATION_CREDENTIAL = /\b(authorization)(\s*:\s*)(bearer|basic)(\s+)([^\r\n]+)/gi;

const URL_QUERY_SECRET =
  /(^|[?&])((?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)=)([^&\s"'<>;]+(?:&(?![A-Za-z0-9_.-]+\s*=)[^&\s"'<>;]+)*)(?=[&\s]|$)/gi;
const ENV_ASSIGNMENT_SECRET =
  /(^|[\r\n])(?!export\s+)(\s*)([A-Za-z0-9_. -]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_. -]*)(\s*=\s*)(?:(["'])(?:\\.|(?!\5)[^"\\\r\n<>]*)\5|([^"'\r\n<>]+))/gi;

const KEYED_CONNECTION_STRING =
  /\b(database_url|dsn|connection_string|jdbc_url|odbc_connection_string|conn_string|connect_string)\b(\s*[:=]\s*)(["']?)([^\r\n]*)/gi;
const URL_USERINFO = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^@\s/?#]+)@/g;
const XML_SECRET =
  /<([A-Za-z0-9_.:-]*(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)[A-Za-z0-9_.:-]*)([^>]*)>([^<]*)<\/\1>/gi;

const CONNECTION_STRING_SECRET =
  /(^|;)(\s*)(Password|Pwd|password|pwd)(\s*=\s*)(["']?)([^;"'\r\n]+)(["']?)/gi;
const PEM_PRIVATE_KEY = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g;

export function maskSensitiveText(input: string): string {
  return input
    .replace(KEYED_CONNECTION_STRING, (_match, key, separator, openQuote, value) => {
      const closeQuote = openQuote && value.endsWith(openQuote) ? openQuote : "";
      return `${key}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(AUTHORIZATION_CREDENTIAL, (_match, key, separator, scheme, space) => {
      return `${key}${separator}${scheme}${space}***`;
    })
    .replace(URL_QUERY_SECRET, (_match, separator, prefix) => `${separator}${prefix}***`)
    .replace(
      CONNECTION_STRING_SECRET,
      (_match, prefix, _space, key, separator, openQuote, value, closeQuote) => {
        if (
          prefix === "" &&
          /^(?:password|pwd)$/i.test(key) &&
          !value.includes(";") &&
          /&[A-Za-z0-9_.-]+\s*=/.test(value)
        ) {
          return _match;
        }

        return `${prefix}${_space}${key}${separator}${openQuote}***${closeQuote}`;
      },
    )
    .replace(
      ENV_ASSIGNMENT_SECRET,
      (_match, lineStart, indent, key, separator, openQuote, value) => {
        if (lineStart === "" && /^(?:password|pwd)$/i.test(key) && value !== undefined) {
          const suffixAttributeIndex = value.indexOf(";");
          if (suffixAttributeIndex >= 0 && /;[^;\r\n]*[A-Za-z0-9_.-]+\s*=/.test(value)) {
            return `${lineStart}${indent}${key}${separator}***${value.slice(suffixAttributeIndex)}`;
          }

          const tailSegments = value.split("&");
          const hasNonTrailingQuerySegments = tailSegments.some(
            (segment: string, index: number) => {
              if (index === 0 || !segment.includes("=")) {
                return false;
              }

              const hasSubsequentSegment = index < tailSegments.length - 1;
              const hasPriorNonQuerySegment = tailSegments
                .slice(1, index)
                .some((priorSegment: string) => !priorSegment.includes("="));

              return (
                /[A-Za-z0-9_.-]+\s*=/.test(segment) &&
                (hasSubsequentSegment || hasPriorNonQuerySegment)
              );
            },
          );

          if (hasNonTrailingQuerySegments) {
            return _match;
          }
        }

        if (openQuote !== undefined) {
          return `${lineStart}${indent}${key}${separator}${openQuote}***${openQuote}`;
        }
        return `${lineStart}${indent}${key}${separator}***`;
      },
    )
    .replace(QUOTED_KEY_VALUE_SECRET, (_match, keyQuote, key, separator, openQuote) => {
      return `${keyQuote}${key}${keyQuote}${separator}${openQuote}***${openQuote}`;
    })
    .replace(EXPORT_KEY_VALUE_SECRET, (_match, prefix, key, separator, quotedValue, openQuote) => {
      if (quotedValue !== undefined) {
        return `${prefix}${key}${separator}${openQuote}***${openQuote}`;
      }
      return `${prefix}${key}${separator}***`;
    })
    .replace(KEY_VALUE_SECRET, (_match, key, separator, openQuote, _value, closeQuote) => {
      return `${key}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(XML_SECRET, (_match, key, attrs) => `<${key}${attrs}>***</${key}>`)
    .replace(URL_USERINFO, (_match, prefix) => `${prefix}***@`)
    .replace(PEM_PRIVATE_KEY, (match, label) => {
      const endMarker = `-----END ${label}-----`;
      if (!match.includes(endMarker)) {
        return `-----BEGIN ${label}-----\n***`;
      }
      return `-----BEGIN ${label}-----\n***\n${endMarker}`;
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
