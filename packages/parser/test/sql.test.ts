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

  it("does not split statements on semicolons inside comments", () => {
    const statements = parseSqlStatements(`
      select * from users -- this comment has a ; semicolon
      where active = 1;
      select * from teams /* this block has ; and more ; text */;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]?.operation).toBe("select");
    expect(statements[0]?.referencedTables).toEqual(["users"]);
    expect(statements[1]?.operation).toBe("select");
    expect(statements[1]?.referencedTables).toEqual(["teams"]);
  });

  it("does not split statements on semicolons inside PostgreSQL dollar quotes", () => {
    const statements = parseSqlStatements(`
      do $$
      begin
        perform 'value;inside';
      end
      $$;
      select * from audit_logs;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]?.preview).toContain("value;inside");
    expect(statements[1]?.operation).toBe("select");
    expect(statements[1]?.referencedTables).toEqual(["audit_logs"]);
  });

  it("keeps semicolons inside escaped SQL quotes in the same statement", () => {
    const statements = parseSqlStatements(`
      insert into messages (body) values ('it''s still; one value');
      select * from messages;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]?.operation).toBe("insert");
    expect(statements[0]?.referencedTables).toEqual(["messages"]);
    expect(statements[1]?.operation).toBe("select");
  });
});
