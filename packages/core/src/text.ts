import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";

export type DecodedText = {
  text: string;
  encoding: string;
  bytesRead: number;
  truncated: boolean;
};

const TEXT_ENCODINGS = ["utf-8", "shift_jis", "utf-16le"] as const;

export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
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

    if (looksBinary(buffer)) {
      return {
        text: "",
        encoding: "binary",
        bytesRead: buffer.length,
        truncated
      };
    }

    for (const encoding of TEXT_ENCODINGS) {
      try {
        const decoder = new TextDecoder(encoding, { fatal: false });
        const text = decoder.decode(buffer);
        if (text.includes("\uFFFD") && encoding === "utf-8") {
          continue;
        }
        return {
          text,
          encoding,
          bytesRead: buffer.length,
          truncated
        };
      } catch {
        continue;
      }
    }

    return {
      text: buffer.toString("utf8"),
      encoding: "utf-8-lossy",
      bytesRead: buffer.length,
      truncated
    };
  } finally {
    await file.close();
  }
}
