import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";

export type DecodedText = {
  text: string;
  encoding: string;
  bytesRead: number;
  truncated: boolean;
};

const TEXT_ENCODINGS = ["utf-8", "shift_jis", "utf-16le"] as const;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM = [0xff, 0xfe] as const;
const MIN_UTF16LE_HEURISTIC_BYTES = 16;

export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }
  if (startsWithBytes(buffer, UTF16LE_BOM) || looksUtf16Le(buffer)) {
    return false;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nulCount = 0;
  for (const byte of sample) {
    if (byte === 0) {
      nulCount += 1;
    }
  }
  return nulCount > sample.length * 0.1;
}

export async function readTextFile(filePath: string, maxBytes: number): Promise<DecodedText> {
  const file = await open(filePath, "r");
  try {
    const fileStat = await file.stat();
    const length = Math.min(fileStat.size, maxBytes);
    const slice = Buffer.alloc(length);
    const { bytesRead } = await file.read(slice, 0, length, 0);
    const buffer = slice.subarray(0, bytesRead);
    const truncated = fileStat.size > bytesRead;

    const decoded = decodeTextBuffer(buffer);
    return {
      ...decoded,
      bytesRead: buffer.length,
      truncated,
    };
  } finally {
    await file.close();
  }
}

function decodeTextBuffer(buffer: Buffer): Omit<DecodedText, "bytesRead" | "truncated"> {
  if (startsWithBytes(buffer, UTF8_BOM)) {
    return decodeWithEncoding(buffer.subarray(UTF8_BOM.length), "utf-8");
  }
  if (startsWithBytes(buffer, UTF16LE_BOM)) {
    return decodeWithEncoding(buffer.subarray(UTF16LE_BOM.length), "utf-16le");
  }
  if (looksUtf16Le(buffer)) {
    return decodeWithEncoding(buffer, "utf-16le");
  }
  if (looksBinary(buffer)) {
    return {
      text: "",
      encoding: "binary",
    };
  }

  for (const encoding of TEXT_ENCODINGS) {
    const decoded = tryDecodeWithEncoding(buffer, encoding);
    if (decoded) {
      return decoded;
    }
  }

  return decodeWithEncoding(buffer, "utf-8-lossy");
}

function tryDecodeWithEncoding(
  buffer: Buffer,
  encoding: (typeof TEXT_ENCODINGS)[number],
): Omit<DecodedText, "bytesRead" | "truncated"> | null {
  try {
    const decoder = new TextDecoder(encoding, { fatal: encoding !== "shift_jis" });
    const text = decoder.decode(buffer);
    if (encoding === "shift_jis" && text.includes("\uFFFD")) {
      return null;
    }
    return {
      text: stripBom(text),
      encoding,
    };
  } catch {
    return null;
  }
}

function decodeWithEncoding(
  buffer: Buffer,
  encoding: string,
): Omit<DecodedText, "bytesRead" | "truncated"> {
  const decoderEncoding = encoding === "utf-8-lossy" ? "utf-8" : encoding;
  const decoder = new TextDecoder(decoderEncoding, { fatal: false });
  return {
    text: stripBom(decoder.decode(buffer)),
    encoding,
  };
}

function startsWithBytes(buffer: Buffer, prefix: readonly number[]): boolean {
  if (buffer.length < prefix.length) {
    return false;
  }
  return prefix.every((byte, index) => buffer[index] === byte);
}

function looksUtf16Le(buffer: Buffer): boolean {
  if (buffer.length < MIN_UTF16LE_HEURISTIC_BYTES) {
    return false;
  }
  const sampleLength = Math.min(buffer.length, 4096);
  let oddNulCount = 0;
  let evenNulCount = 0;
  let nonNulCount = 0;
  let printableNonNulCount = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index]!;
    if (byte !== 0) {
      nonNulCount += 1;
      if (isPrintableAsciiOrWhitespace(byte)) {
        printableNonNulCount += 1;
      }
      continue;
    }
    if (index % 2 === 0) {
      evenNulCount += 1;
    } else {
      oddNulCount += 1;
    }
  }
  return (
    oddNulCount > sampleLength * 0.2 &&
    evenNulCount < sampleLength * 0.05 &&
    nonNulCount > 0 &&
    printableNonNulCount / nonNulCount >= 0.85
  );
}

function isPrintableAsciiOrWhitespace(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}
