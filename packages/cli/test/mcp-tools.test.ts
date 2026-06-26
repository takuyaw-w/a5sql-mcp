import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseFile } from "../src/index.js";
import {
  findA5sqlTables,
  formatFullParsedFile,
  generateMermaidErDiagram,
  generateModelFiles,
  generateSqlSelect,
  listA5sqlTables,
  listA5sqlRelationships,
  reviewA5sqlSchema,
  sliceFileText,
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

function buildLargeA5er(tableCount: number, columnsPerTable: number): string {
  const lines = ["# A5:ER FORMAT:19", "# A5:ER ENCODING:UTF8", "[Manager]", 'ProjectName="Large"'];

  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const tableName = `table_${String(tableIndex).padStart(3, "0")}`;
    lines.push(
      "",
      "[Entity]",
      `PName=${tableName}`,
      `LName=テーブル${tableIndex}`,
      "Comment=large fixture",
    );
    for (let columnIndex = 0; columnIndex < columnsPerTable; columnIndex += 1) {
      const columnName =
        columnIndex === 0 ? "id" : columnIndex === 1 ? "table_000_id" : `column_${columnIndex}`;
      const keyOrder = columnIndex === 0 ? "0" : "";
      lines.push(
        `Field="列${columnIndex}","${columnName}","Integer","NOT NULL",${keyOrder},"","fixture column",$FFFFFFFF,""`,
      );
    }
  }

  for (let relationIndex = 1; relationIndex <= 60; relationIndex += 1) {
    const targetName = `table_${String(relationIndex).padStart(3, "0")}`;
    lines.push(
      "",
      "[Relation]",
      "Entity1=table_000",
      `Entity2=${targetName}`,
      "Fields1=id",
      "Fields2=table_000_id",
      "RelationType1=2",
      "RelationType2=3",
      `Caption=relates ${relationIndex}`,
    );
  }

  return lines.join("\n");
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

  it("uses lookup indexes for logical table names", async () => {
    const parsed = await parseSampleA5er();

    const relationships = listA5sqlRelationships(parsed, { tableName: "ユーザープロフィール" }) as {
      foundTable: boolean;
      relationships: Array<{ targetTable: string }>;
    };
    const select = generateSqlSelect(parsed, {
      tableName: "ユーザー",
      includeRelations: true,
      relatedTables: ["注文"],
    }) as {
      found: boolean;
      includedTables: string[];
    };

    expect(relationships.foundTable).toBe(true);
    expect(relationships.relationships).toEqual([
      expect.objectContaining({
        targetTable: "user_profiles",
      }),
    ]);
    expect(select.found).toBe(true);
    expect(select.includedTables).toEqual(["users", "orders"]);
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

  it("handles large a5er files with paging and bounded generated output", async () => {
    const source = buildLargeA5er(240, 45);
    expect(source.split(/\r?\n/).length).toBeGreaterThan(11_000);

    const dir = path.join(os.tmpdir(), `a5sql-mcp-large-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "large.a5er");
    await writeFile(filePath, source, "utf8");
    const parsed = (await parseFile(filePath)) as A5erCliResult;

    expect(parsed.parsed.tables).toHaveLength(240);
    expect(parsed.parsed.relationships).toHaveLength(60);

    const tablePage = listA5sqlTables(parsed, { offset: 100, limit: 25 }) as {
      totalTableCount: number;
      returnedTableCount: number;
      hasMore: boolean;
      tables: Array<{ name: string; columnCount: number }>;
    };
    expect(tablePage.totalTableCount).toBe(240);
    expect(tablePage.returnedTableCount).toBe(25);
    expect(tablePage.hasMore).toBe(true);
    expect(tablePage.tables[0]).toEqual(
      expect.objectContaining({
        name: "table_100",
        columnCount: 45,
      }),
    );

    const mermaid = generateMermaidErDiagram(parsed, {
      includeColumns: false,
      maxTables: 10,
    }) as {
      tableCount: number;
      totalMatchedTableCount: number;
      truncated: boolean;
      warnings: string[];
    };
    expect(mermaid.tableCount).toBe(10);
    expect(mermaid.totalMatchedTableCount).toBe(240);
    expect(mermaid.truncated).toBe(true);
    expect(mermaid.warnings).toContain("table_output_truncated:10/240");

    const models = generateModelFiles(parsed, {
      framework: "laravel",
      maxTables: 3,
    }) as {
      tableCount: number;
      totalMatchedTableCount: number;
      truncated: boolean;
      files: Array<{ path: string }>;
      warnings: string[];
    };
    expect(models.tableCount).toBe(3);
    expect(models.totalMatchedTableCount).toBe(240);
    expect(models.files).toHaveLength(3);
    expect(models.truncated).toBe(true);
    expect(models.warnings).toContain("table_output_truncated:3/240");

    const select = generateSqlSelect(parsed, {
      tableName: "table_000",
      includeRelations: true,
      maxRelatedTables: 5,
    }) as {
      relatedRelationshipCount: number;
      includedTables: string[];
      truncated: boolean;
      warnings: string[];
    };
    expect(select.relatedRelationshipCount).toBe(60);
    expect(select.includedTables).toHaveLength(6);
    expect(select.truncated).toBe(true);
    expect(select.warnings).toContain("related_table_output_truncated:5/60");

    const slice = sliceFileText(source, {
      filePath,
      kind: "a5er",
      maxChars: 5_000,
      startLine: 100,
      maxLines: 20,
    }) as {
      totalLines: number;
      returnedLineCount: number;
      hasMore: boolean;
      nextStartLine: number;
    };
    expect(slice.totalLines).toBeGreaterThan(11_000);
    expect(slice.returnedLineCount).toBe(20);
    expect(slice.hasMore).toBe(true);
    expect(slice.nextStartLine).toBe(120);
  });

  it("bounds full parse output for large a5er files", async () => {
    const source = buildLargeA5er(120, 30);
    const dir = path.join(os.tmpdir(), `a5sql-mcp-full-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "large-full.a5er");
    await writeFile(filePath, source, "utf8");
    const parsed = (await parseFile(filePath)) as A5erCliResult;

    const output = formatFullParsedFile(parsed, {
      maxTables: 5,
      maxRelationships: 7,
      maxColumnsPerTable: 3,
    }) as {
      mode: string;
      totalTableCount: number;
      totalRelationshipCount: number;
      truncated: { tables: boolean; relationships: boolean; columns: boolean };
      tables: Array<{ columns: unknown[]; columnCount: number; columnsTruncated: boolean }>;
      relationships: unknown[];
    };

    expect(output.mode).toBe("full");
    expect(output.totalTableCount).toBe(120);
    expect(output.totalRelationshipCount).toBe(60);
    expect(output.tables).toHaveLength(5);
    expect(output.relationships).toHaveLength(7);
    expect(output.tables[0]?.columns).toHaveLength(3);
    expect(output.tables[0]?.columnCount).toBe(30);
    expect(output.tables[0]?.columnsTruncated).toBe(true);
    expect(output.truncated).toEqual({
      tables: true,
      relationships: true,
      columns: true,
    });
  });

  it("returns explicit guidance for unrecognized a5er helper calls", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-unrecognized-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "broken.a5er");
    await writeFile(filePath, "not an a5er document", "utf8");
    const parsed = (await parseFile(filePath)) as A5erCliResult;

    const output = listA5sqlTables(parsed) as {
      parseStatus: string;
      message: string;
      warnings: string[];
      tables: unknown[];
      nextAction: string;
    };

    expect(output.parseStatus).toBe("unrecognized");
    expect(output.message).toBe("configured_a5er_file_is_not_recognized");
    expect(output.warnings).toContain("a5er_structure_not_recognized");
    expect(output.tables).toEqual([]);
    expect(output.nextAction).toContain("read_a5sql_file");
  });
});
