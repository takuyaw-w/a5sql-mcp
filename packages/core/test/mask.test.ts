import { describe, expect, it } from "vitest";

import { maskSensitiveText, maskValue } from "../src/mask.js";

describe("maskSensitiveText", () => {
  it("masks common key-value secrets", () => {
    const input = [
      "host=localhost",
      "password=super-secret",
      "pwd = another-secret",
      "token: abcdef",
    ].join("\n");

    expect(maskSensitiveText(input)).toContain("password=***");
    expect(maskSensitiveText(input)).toContain("pwd = ***");
    expect(maskSensitiveText(input)).toContain("token: ***");
    expect(maskSensitiveText(input)).toContain("host=localhost");
  });

  it("masks xml-like secrets", () => {
    expect(maskSensitiveText("<Password>secret</Password>")).toBe("<Password>***</Password>");
  });

  it("masks private key values", () => {
    const input = [
      "private_key=raw-private-key",
      "ssh_private_key: raw-ssh-private-key",
      "PrivateKey=raw-camel-private-key",
    ].join("\n");

    const masked = maskSensitiveText(input);
    expect(masked).toContain("private_key=***");
    expect(masked).toContain("ssh_private_key: ***");
    expect(masked).toContain("PrivateKey=***");
    expect(masked).not.toContain("raw-private-key");
    expect(masked).not.toContain("raw-ssh-private-key");
    expect(masked).not.toContain("raw-camel-private-key");
  });

  it("masks PEM private key blocks", () => {
    const input = [
      "before",
      "-----BEGIN PRIVATE KEY-----",
      "raw-private-key-material",
      "-----END PRIVATE KEY-----",
      "after",
    ].join("\n");

    const masked = maskSensitiveText(input);
    expect(masked).toContain("before");
    expect(masked).toContain("-----BEGIN PRIVATE KEY-----");
    expect(masked).toContain("***");
    expect(masked).toContain("-----END PRIVATE KEY-----");
    expect(masked).toContain("after");
    expect(masked).not.toContain("raw-private-key-material");
  });
});

describe("maskValue", () => {
  it("masks non-secret fields unless reveal is requested", () => {
    expect(maskValue("database", false)).toBe("d***e");
    expect(maskValue("database", true)).toBe("database");
  });
});
