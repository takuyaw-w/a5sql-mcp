import { describe, expect, it } from "vitest";

import { maskSensitiveText, maskValue } from "../src/mask.js";

describe("maskSensitiveText", () => {
  it("masks common key-value secrets", () => {
    const input = [
      "host=localhost",
      "password=super-secret",
      "pwd = another-secret",
      "token: abcdef"
    ].join("\n");

    expect(maskSensitiveText(input)).toContain("password=***");
    expect(maskSensitiveText(input)).toContain("pwd = ***");
    expect(maskSensitiveText(input)).toContain("token: ***");
    expect(maskSensitiveText(input)).toContain("host=localhost");
  });

  it("masks xml-like secrets", () => {
    expect(maskSensitiveText("<Password>secret</Password>")).toBe("<Password>***</Password>");
  });
});

describe("maskValue", () => {
  it("masks non-secret fields unless reveal is requested", () => {
    expect(maskValue("database", false)).toBe("d***e");
    expect(maskValue("database", true)).toBe("database");
  });
});
