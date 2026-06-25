import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseFile } from "../src/index.js";
import {
  findA5sqlTables,
  generateMermaidErDiagram,
  generateModelFiles,
  generateSqlSelect,
  listA5sqlRelationships,
  reviewA5sqlSchema,
  type A5erCliResult,
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
      'Field="ユーザーID","id","bigserial","NOT NULL",0,"","ユーザーの一意なID",$FFFFFFFF,""',
      'Field="メールアドレス","email","varchar(255)","NOT NULL",,"","ログインに使うメールアドレス",$FFFFFFFF,""',
      "",
      "[Entity]",
      "PName=user_profiles",
      "LName=ユーザープロフィール",
      'Field="ユーザーID","user_id","bigint","NOT NULL",0,"","users.id を参照",$FFFFFFFF,""',
      'Field="電話番号","phone_number","varchar(30)",,,"","電話番号",$FFFFFFFF,""',
      "",
      "[Entity]",
      "PName=orders",
      "LName=注文",
      'Field="注文ID","id","bigserial","NOT NULL",0,"","注文の一意なID",$FFFFFFFF,""',
      'Field="ユーザーID","user_id","bigint","NOT NULL",,"","users.id を参照",$FFFFFFFF,""',
      'Field="注文番号","order_number","varchar(40)","NOT NULL",,"","ユーザー向け注文番号",$FFFFFFFF,""',
      "",
      "[Entity]",
      "PName=audit_logs",
      "LName=監査ログ",
      'Field="監査ログID","id","bigserial","NOT NULL",,"","監査ログの一意なID",$FFFFFFFF,""',
      'Field="ユーザーID","user_id","bigint","NOT NULL",,"","users.id を参照",$FFFFFFFF,""',
      'Field="詳細","details",,,,"","",$FFFFFFFF,""',
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
      "Caption=places orders",
    ].join("\n"),
    "utf8",
  );
  return (await parseFile(filePath)) as A5erCliResult;
}

describe("A5:ER MCP tool helpers", () => {
  it("lists relationships and can filter by table", async () => {
    const parsed = await parseSampleA5er();

    const output = listA5sqlRelationships(parsed, { tableName: "user_profiles" }) as {
      foundTable: boolean;
      relationships: Array<{
        sourceTable: string;
        targetTable: string;
        targetColumns: string[];
        caption?: string;
      }>;
    };

    expect(output.foundTable).toBe(true);
    expect(output.relationships).toEqual([
      expect.objectContaining({
        sourceTable: "users",
        targetTable: "user_profiles",
        targetColumns: ["user_id"],
        caption: "has profile",
      }),
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
        matchedBy: ["column:phone_number"],
      }),
    ]);
  });

  it("generates SELECT SQL with direct relationships and parameters", async () => {
    const parsed = await parseSampleA5er();

    const output = generateSqlSelect(parsed, {
      tableName: "users",
      includeRelations: true,
      relatedTables: ["orders"],
      whereColumns: ["id"],
      limit: 50,
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
    expect(output.sql).toContain('LEFT JOIN "orders" AS "t1" ON "t1"."user_id" = "t0"."id"');
    expect(output.sql).toContain('WHERE "t0"."id" = :id');
    expect(output.sql).toContain("LIMIT 50;");
  });

  it("does not join all relationships when related table filters do not match", async () => {
    const parsed = await parseSampleA5er();

    const output = generateSqlSelect(parsed, {
      tableName: "users",
      includeRelations: true,
      relatedTables: ["missing_table"],
    }) as {
      includedTables: string[];
      sql: string;
      warnings: string[];
    };

    expect(output.includedTables).toEqual(["users"]);
    expect(output.sql).not.toContain("LEFT JOIN");
    expect(output.warnings).toEqual(["related_table_filter_not_found:missing_table"]);
  });

  it("generates Mermaid ER diagram text", async () => {
    const parsed = await parseSampleA5er();

    const output = generateMermaidErDiagram(parsed, {
      tableNames: ["users", "orders"],
    }) as {
      mermaid: string;
      relationshipCount: number;
      tableCount: number;
      warnings: string[];
    };

    expect(output.tableCount).toBe(2);
    expect(output.relationshipCount).toBe(1);
    expect(output.warnings).toEqual([]);
    expect(output.mermaid).toContain("erDiagram");
    expect(output.mermaid).toContain("users ||--o{ orders : places orders");
    expect(output.mermaid).toContain('bigserial id PK NOT_NULL "ユーザーID"');
  });

  it("reviews schema quality issues", async () => {
    const parsed = await parseSampleA5er();

    const output = reviewA5sqlSchema(parsed, { includeInfo: false }) as {
      summary: { error: number; warning: number; info: number };
      issues: Array<{ code: string; table?: string; column?: string }>;
    };

    expect(output.summary.error).toBeGreaterThanOrEqual(1);
    expect(output.summary.warning).toBeGreaterThanOrEqual(2);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "table_without_primary_key",
          table: "audit_logs",
        }),
        expect.objectContaining({
          code: "foreign_key_like_column_without_relationship",
          table: "audit_logs",
          column: "user_id",
        }),
        expect.objectContaining({
          code: "column_missing_data_type",
          table: "audit_logs",
          column: "details",
        }),
      ]),
    );
  });

  it("generates Laravel model files", async () => {
    const parsed = await parseSampleA5er();

    const output = generateModelFiles(parsed, {
      framework: "laravel",
      tableNames: ["users"],
    }) as {
      files: Array<{ path: string; content: string }>;
      tableCount: number;
    };

    expect(output.tableCount).toBe(1);
    expect(output.files[0]?.path).toBe("app/Models/User.php");
    expect(output.files[0]?.content).toContain("class User extends Model");
    expect(output.files[0]?.content).toContain("protected $table = 'users';");
    expect(output.files[0]?.content).toContain("public function orders()");
    expect(output.files[0]?.content).toContain(
      "return $this->hasMany(Order::class, 'user_id', 'id');",
    );
  });

  it("generates SQLAlchemy model file", async () => {
    const parsed = await parseSampleA5er();

    const output = generateModelFiles(parsed, {
      framework: "sqlalchemy",
      tableNames: ["users", "orders"],
    }) as {
      files: Array<{ path: string; content: string }>;
      tableCount: number;
    };

    expect(output.tableCount).toBe(2);
    expect(output.files).toHaveLength(1);
    expect(output.files[0]?.path).toBe("models.py");
    expect(output.files[0]?.content).toContain("class User(Base):");
    expect(output.files[0]?.content).toContain('__tablename__ = "orders"');
    expect(output.files[0]?.content).toContain('ForeignKey("users.id")');
  });
});
