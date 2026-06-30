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

  it("masks truncated PEM private key blocks", () => {
    const input = ["before", "-----BEGIN PRIVATE KEY-----", "raw-private-key-material"].join("\n");

    const masked = maskSensitiveText(input);
    expect(masked).toContain("before");
    expect(masked).toContain("-----BEGIN PRIVATE KEY-----");
    expect(masked).toContain("***");
    expect(masked).not.toContain("raw-private-key-material");
  });

  it("masks keyed connection URLs and connection strings", () => {
    const input = [
      "DATABASE_URL=postgres://alice:raw-password@localhost/app",
      "CONNECTION_STRING=Server=localhost;User ID=alice;Password=raw-password;Database=app",
      "DSN=mysql://bob:dsn-secret@localhost/app",
      "host=localhost",
    ].join("\n");

    const masked = maskSensitiveText(input);

    expect(masked).toContain("DATABASE_URL=***");
    expect(masked).toContain("CONNECTION_STRING=***");
    expect(masked).toContain("DSN=***");
    expect(masked).toContain("host=localhost");
    expect(masked).not.toContain("raw-password");
    expect(masked).not.toContain("dsn-secret");
    expect(masked).not.toContain("postgres://alice:raw-password@localhost/app");
    expect(masked).not.toContain(
      "Server=localhost;User ID=alice;Password=raw-password;Database=app",
    );
    expect(masked).not.toContain("mysql://bob:dsn-secret@localhost/app");
  });

  it("masks inline URL userinfo passwords without masking non-secret values", () => {
    const masked = maskSensitiveText("host=localhost\npostgres://alice:url-secret@localhost/app");

    expect(masked).toContain("host=localhost");
    expect(masked).toContain("postgres://***@localhost/app");
    expect(masked).not.toContain("url-secret");
    expect(masked).not.toContain("alice:url-secret");
  });

  it("masks inline URL userinfo tokens without passwords", () => {
    const masked = maskSensitiveText(
      [
        "select 'postgres://raw-token@localhost/app' as db_url;",
        "repository=https://ghp_rawtoken@github.com/example/private-repo.git",
      ].join("\n"),
    );

    expect(masked).toContain("postgres://***@localhost/app");
    expect(masked).toContain("https://***@github.com/example/private-repo.git");
    expect(masked).not.toContain("raw-token");
    expect(masked).not.toContain("ghp_rawtoken");
  });

  it("masks JSON-style quoted secret keys", () => {
    const masked = maskSensitiveText(
      JSON.stringify({
        host: "localhost",
        password: "json-password",
        api_key: "json-api-key",
        refreshToken: "json-refresh-token",
      }),
    );

    expect(masked).toContain('"host":"localhost"');
    expect(masked).toContain('"password":"***"');
    expect(masked).toContain('"api_key":"***"');
    expect(masked).toContain('"refreshToken":"***"');
    expect(masked).not.toContain("json-password");
    expect(masked).not.toContain("json-api-key");
    expect(masked).not.toContain("json-refresh-token");
  });

  it("masks env export secret assignments", () => {
    const masked = maskSensitiveText(
      ["export API_KEY=abc&def", 'export ACCESS_TOKEN="abc&def"', "HOST=localhost"].join("\n"),
    );

    expect(masked).toContain("export API_KEY=***");
    expect(masked).toContain('export ACCESS_TOKEN="***"');
    expect(masked).toContain("HOST=localhost");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("abc&def");
  });

  it("masks env assignments with semicolons and quoted ampersands", () => {
    const masked = maskSensitiveText(
      ["ACCESS_TOKEN=abc;def", 'API_KEY="abc&def"', "HOST=localhost"].join("\n"),
    );

    expect(masked).toContain("ACCESS_TOKEN=***");
    expect(masked).toContain('API_KEY="***"');
    expect(masked).toContain("HOST=localhost");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("abc;def");
    expect(masked).not.toContain("abc&def");
  });

  it("masks unquoted env export assignments with semicolons and preserves next line", () => {
    const masked = maskSensitiveText(["export ACCESS_TOKEN=abc;def", "HOST=localhost"].join("\n"));

    expect(masked).toContain("export ACCESS_TOKEN=***");
    expect(masked).toContain("HOST=localhost");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("abc;def");
  });

  it("masks env assignments with ampersand query-like suffix", () => {
    const masked = maskSensitiveText(
      ["API_KEY=abc&def=true", "ACCESS_TOKEN=abc&def=true", "HOST=localhost"].join("\n"),
    );

    expect(masked).toContain("API_KEY=***");
    expect(masked).toContain("ACCESS_TOKEN=***");
    expect(masked).toContain("HOST=localhost");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def=true");
    expect(masked).not.toContain("abc&def=true");
  });

  it("masks authorization header credentials", () => {
    const masked = maskSensitiveText(
      [
        "Authorization: Bearer raw-bearer-token",
        "authorization: Basic raw-basic-token",
        "X-Request-Id: request-1",
      ].join("\n"),
    );

    expect(masked).toContain("Authorization: Bearer ***");
    expect(masked).toContain("authorization: Basic ***");
    expect(masked).toContain("X-Request-Id: request-1");
    expect(masked).not.toContain("raw-bearer-token");
    expect(masked).not.toContain("raw-basic-token");
  });

  it("masks URL query credentials", () => {
    const masked = maskSensitiveText(
      "jdbc:postgresql://localhost/app?user=alice&password=query-password&ssl=true&token=query-token",
    );

    expect(masked).toContain("password=***");
    expect(masked).toContain("token=***");
    expect(masked).toContain("user=alice");
    expect(masked).toContain("ssl=true");
    expect(masked).not.toContain("query-password");
    expect(masked).not.toContain("query-token");
  });

  it("masks URL query credentials including ambiguous suffix segments", () => {
    const masked = maskSensitiveText(
      "http://x/app?user=alice&password=abc&def&ssl=true&token=tok&dangling",
    );

    expect(masked).toContain("password=***");
    expect(masked).toContain("token=***");
    expect(masked).toContain("user=alice");
    expect(masked).toContain("ssl=true");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("token=tok");
    expect(masked).not.toContain("&dangling");
  });

  it("masks bare query-like strings with ambiguous suffixes", () => {
    const masked = maskSensitiveText("password=abc&def&ssl=true&token=tok&dangling");

    expect(masked).toContain("password=***");
    expect(masked).toContain("ssl=true");
    expect(masked).toContain("token=***");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("token=tok");
    expect(masked).not.toContain("dangling");
  });

  it("masks JSON-style quoted secrets containing semicolons", () => {
    const masked = maskSensitiveText('{"password":"abc;def","host":"localhost"}');

    expect(masked).toContain('"password":"***"');
    expect(masked).toContain('"host":"localhost"');
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("abc;def");
  });

  it("masks JSON-style quoted secrets containing escaped quotes", () => {
    const masked = maskSensitiveText('{"password":"abc\\"def","host":"localhost"}');

    expect(masked).toContain('"password":"***"');
    expect(masked).toContain('"host":"localhost"');
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain('abc\\"def');
  });

  it("masks quoted export secret values containing semicolons", () => {
    const masked = maskSensitiveText('export ACCESS_TOKEN="abc;def"\nHOST=localhost');

    expect(masked).toContain('export ACCESS_TOKEN="***"');
    expect(masked).toContain("HOST=localhost");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("abc;def");
  });

  it("masks JSON values containing ampersands and preserves adjacent fields", () => {
    const masked = maskSensitiveText('{"password":"abc&def","host":"localhost"}');

    expect(masked).toContain('"password":"***"');
    expect(masked).toContain('"host":"localhost"');
    expect(masked).not.toContain("abc&def");
  });

  it("masks JSON values containing closing braces and preserves adjacent fields", () => {
    const masked = maskSensitiveText('{"password":"abc}def","host":"localhost"}');

    expect(masked).toContain('"password":"***"');
    expect(masked).toContain('"host":"localhost"');
    expect(masked).not.toContain("abc}def");
  });

  it("masks inline ODBC-style credentials containing ampersands", () => {
    const masked = maskSensitiveText("Driver=x;User ID=alice;Pwd=abc&def;Database=app");

    expect(masked).toContain("Driver=x;User ID=alice;Pwd=***;Database=app");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def");
    expect(masked).not.toContain("abc&def");
  });

  it("masks inline ODBC-style credentials with ampersand name=value suffix", () => {
    const masked = maskSensitiveText("Driver=x;Pwd=abc&def=true;Database=app");

    expect(masked).toContain("Driver=x");
    expect(masked).toContain("Database=app");
    expect(masked).toContain("Pwd=***");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def=true");
    expect(masked).not.toContain("abc&def=true");
  });

  it("masks inline ODBC-style credentials with Password key and ampersand name=value suffix", () => {
    const masked = maskSensitiveText("Driver=x;Password=abc&def=true;Database=app");

    expect(masked).toContain("Driver=x");
    expect(masked).toContain("Database=app");
    expect(masked).toContain("Password=***");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("def=true");
    expect(masked).not.toContain("abc&def=true");
  });

  it("masks ODBC final Pwd credential", () => {
    const pwd = maskSensitiveText("Pwd=abc&def=true");

    expect(pwd).toContain("Pwd=***");
    expect(pwd).not.toContain("abc");
    expect(pwd).not.toContain("def=true");
    expect(pwd).not.toContain("abc&def=true");
  });

  it("masks final lowercase pwd credential", () => {
    const pwd = maskSensitiveText("pwd=abc&def=true");

    expect(pwd).toContain("pwd=***");
    expect(pwd).not.toContain("abc");
    expect(pwd).not.toContain("def=true");
    expect(pwd).not.toContain("abc&def=true");
  });

  it("masks ODBC final Password credential", () => {
    const password = maskSensitiveText("Password=abc&def=true");

    expect(password).toContain("Password=***");
    expect(password).not.toContain("abc");
    expect(password).not.toContain("def=true");
    expect(password).not.toContain("abc&def=true");
  });

  it("masks final lowercase password credential", () => {
    const password = maskSensitiveText("password=abc&def=true");

    expect(password).toContain("password=***");
    expect(password).not.toContain("abc");
    expect(password).not.toContain("def=true");
    expect(password).not.toContain("abc&def=true");
  });

  it("masks ODBC final Pwd credential with trailing driver", () => {
    const pwd = maskSensitiveText("Pwd=abc&def=true;Driver=x");

    expect(pwd).toContain("Pwd=***;Driver=x");
    expect(pwd).not.toContain("abc");
    expect(pwd).not.toContain("def=true");
    expect(pwd).not.toContain("abc&def=true");
  });

  it("masks ODBC final Password credential with trailing database", () => {
    const password = maskSensitiveText("Password=abc&def=true;Database=app");

    expect(password).toContain("Password=***;Database=app");
    expect(password).not.toContain("abc");
    expect(password).not.toContain("def=true");
    expect(password).not.toContain("abc&def=true");
  });

  it("masks inline ODBC-style connection string credentials", () => {
    const masked = maskSensitiveText(
      "Driver=PostgreSQL;Server=localhost;User ID=alice;Pwd=odbc-password;Database=app",
    );

    expect(masked).toContain("Server=localhost");
    expect(masked).toContain("User ID=alice");
    expect(masked).toContain("Pwd=***");
    expect(masked).not.toContain("odbc-password");
  });
});

describe("maskValue", () => {
  it("masks non-secret fields unless reveal is requested", () => {
    expect(maskValue("database", false)).toBe("d***e");
    expect(maskValue("database", true)).toBe("database");
  });
});
