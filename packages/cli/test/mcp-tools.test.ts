import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseFile } from "../src/index.js";
import {
  findA5sqlTables,
  generateSqlSelect,
  listA5sqlRelationships,
  type A5erCliResult
} from "../src/mcp.js";

async function parseSampleA5er(): Promise<A5erCliResult> {
  const dir = path.join(os.tmpdir(), `a5sql-mcp-tools-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "model.a5er");
  await writeFile(
    filePath,
    [
      "# A5:ER FORMAT:19",
      "[Entity]",
      "PName=users",
      "LName=ユーザー",
      "Comment=サービス利用者",
      "Field=\"ユーザーID\",\"id\",\"bigserial\",\"NOT NULL\",0,\"\",\"ユーザーの一意なID\",$FFFFFFFF,\"\"",
      "Field=\"メールアドレス\",\"email\",\"varchar(255)\",\"NOT NULL\",,\"\",\"ログインに使うメールアドレス\",$FFFFFFFF,\"\"",
      "",
      "[Entity]",
      "PName=user_profiles",
      "LName=ユーザープロフィール",
      "Field=\"ユーザーID\",\"user_id\",\"bigint\",\"NOT NULL\",0,\"\",\"users.id を参照\",$FFFFFFFF,\"\"",
      "Field=\"電話番号\",\"phone_number\",\"varchar(30)\",,,\"\",\"電話番号\",$FFFFFFFF,\"\"",
      "",
      "[Entity]",
      "PName=orders",
      "LName=注文",
      "Field=\"注文ID\",\"id\",\"bigserial\",\"NOT NULL\",0,\"\",\"注文の一意なID\",$FFFFFFFF,\"\"",
      "Field=\"ユーザーID\",\"user_id\",\"bigint\",\"NOT NULL\",,\"\",\"users.id を参照\",$FFFFFFFF,\"\"",
      "Field=\"注文番号\",\"order_number\",\"varchar(40)\",\"NOT NULL\",,\"\",\"ユーザー向け注文番号\",$FFFFFFFF,\"\"",
      "",
      "[Relation]",
      "Entity1=users",
      "Entity2=user_profiles",
      "Fields1=id",
      "Fields2=user_id",
      "RelationType1=2",
      "RelationType2=2",
      "Caption=has profile",
      "",
      "[Relation]",
      "Entity1=users",
      "Entity2=orders",
      "Fields1=id",
      "Fields2=user_id",
      "RelationType1=2",
      "RelationType2=3",
      "Caption=places orders"
    ].join("\n"),
    "utf8"
  );
  return await parseFile(filePath) as A5erCliResult;
}

describe("A5:ER MCP tool helpers", () => {
  it("lists relationships and can filter by table", async () => {
    const parsed = await parseSampleA5er();

    const output = listA5sqlRelationships(parsed, { tableName: "user_profiles" }) as {
      foundTable: boolean;
      relationships: Array<{ sourceTable: string; targetTable: string; targetColumns: string[]; caption?: string }>;
    };

    expect(output.foundTable).toBe(true);
    expect(output.relationships).toEqual([
      expect.objectContaining({
        sourceTable: "users",
        targetTable: "user_profiles",
        targetColumns: ["user_id"],
        caption: "has profile"
      })
    ]);
  });

  it("finds tables by column comment or logical name", async () => {
    const parsed = await parseSampleA5er();

    const output = findA5sqlTables(parsed, { query: "電話", limit: 10 }) as {
      tables: Array<{ name: string; matchedBy: string[] }>;
    };

    expect(output.tables).toEqual([
      expect.objectContaining({
        name: "user_profiles",
        matchedBy: ["column:phone_number"]
      })
    ]);
  });

  it("generates SELECT SQL with direct relationships and parameters", async () => {
    const parsed = await parseSampleA5er();

    const output = generateSqlSelect(parsed, {
      tableName: "users",
      includeRelations: true,
      relatedTables: ["orders"],
      whereColumns: ["id"],
      limit: 50
    }) as {
      found: boolean;
      includedTables: string[];
      parameters: string[];
      sql: string;
      warnings: string[];
    };

    expect(output.found).toBe(true);
    expect(output.includedTables).toEqual(["users", "orders"]);
    expect(output.parameters).toEqual([":id"]);
    expect(output.warnings).toEqual([]);
    expect(output.sql).toContain("LEFT JOIN \"orders\" AS \"t1\" ON \"t1\".\"user_id\" = \"t0\".\"id\"");
    expect(output.sql).toContain("WHERE \"t0\".\"id\" = :id");
    expect(output.sql).toContain("LIMIT 50;");
  });

  it("does not join all relationships when related table filters do not match", async () => {
    const parsed = await parseSampleA5er();

    const output = generateSqlSelect(parsed, {
      tableName: "users",
      includeRelations: true,
      relatedTables: ["missing_table"]
    }) as {
      includedTables: string[];
      sql: string;
      warnings: string[];
    };

    expect(output.includedTables).toEqual(["users"]);
    expect(output.sql).not.toContain("LEFT JOIN");
    expect(output.warnings).toEqual(["related_table_filter_not_found:missing_table"]);
  });
});
