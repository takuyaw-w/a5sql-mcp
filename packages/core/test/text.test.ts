import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decodeTextBuffer, readTextFile } from "../src/text.js";

describe("decodeTextBuffer", () => {
  it.each([
    { name: "empty", buffer: Buffer.alloc(0), text: "", encoding: "utf-8" },
    { name: "UTF-8", buffer: Buffer.from("hello", "utf8"), text: "hello", encoding: "utf-8" },
    {
      name: "UTF-8 BOM",
      buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf8")]),
      text: "hello",
      encoding: "utf-8",
    },
    {
      name: "Shift_JIS",
      buffer: Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]),
      text: "テスト",
      encoding: "shift_jis",
    },
    {
      name: "UTF-16LE BOM",
      buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("A\0B\0", "binary")]),
      text: "AB",
      encoding: "utf-16le",
    },
    {
      name: "short UTF-16LE without BOM",
      buffer: Buffer.from("A\0B\0", "binary"),
      text: "AB",
      encoding: "utf-16le",
    },
  ])("decodes $name with the canonical rules", ({ buffer, text, encoding }) => {
    expect(decodeTextBuffer(buffer)).toEqual({ text, encoding });
  });

  it("classifies NUL-heavy non-text data as binary", () => {
    expect(decodeTextBuffer(Buffer.from([0x00, 0x01, 0x00, 0x02, 0xff, 0x00]))).toEqual({
      text: "",
      encoding: "binary",
    });
  });

  it("does not misclassify a tiny buffer with one odd-position NUL as UTF-16LE", () => {
    expect(decodeTextBuffer(Buffer.from([0x41, 0x00, 0xff]))).toEqual({
      text: "",
      encoding: "binary",
    });
  });

  it("accepts only an incomplete UTF-8 tail when the source read was truncated", () => {
    const truncated = Buffer.from([0x41, 0xe3, 0x81]);

    expect(decodeTextBuffer(truncated, { sourceTruncated: true })).toEqual({
      text: "A",
      encoding: "utf-8",
    });
    expect(
      decodeTextBuffer(Buffer.from([0x41, 0xff, 0x42]), { sourceTruncated: true }).encoding,
    ).not.toBe("utf-8");
  });
});

describe("readTextFile", () => {
  it("returns canonical size and truncation metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-text-"));
    const filePath = path.join(root, "sample.txt");
    await writeFile(filePath, "abcdef", "utf8");

    await expect(readTextFile(filePath, 3)).resolves.toEqual({
      text: "abc",
      encoding: "utf-8",
      bytesRead: 3,
      sizeBytes: 6,
      truncated: true,
    });
  });
});
