import { describe, expect, it } from "vitest";

import { parseSqlStatements } from "../src/index.js";

describe("parseSqlStatements", () => {
  it("extracts operation and referenced tables", () => {
    const statements = parseSqlStatements(`
      select * from users u join teams t on t.id = u.team_id;
      update users set name = 'new';
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]?.operation).toBe("select");
    expect(statements[0]?.referencedTables).toEqual(["teams", "users"]);
    expect(statements[1]?.operation).toBe("update");
    expect(statements[1]?.referencedTables).toEqual(["users"]);
  });
});
