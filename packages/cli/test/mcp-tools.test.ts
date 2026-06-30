import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseFile } from "../src/index.js";
import { compareA5erWithLiveSchemaInputSchema } from "../src/mcp/schema-compare/schemas.js";
import {
  compareA5erWithLiveSchema,
  explainA5sqlTable,
  findA5sqlColumns,
  findA5sqlTables,
  formatFullParsedFile,
  generateMigrationPlan,
  generateMermaidErDiagram,
  generateModelFiles,
  generateSchemaMarkdown,
  generateSqlSelect,
  listA5sqlTables,
  listA5sqlRelationships,
  reviewA5sqlSchema,
  sliceFileText,
  suggestSchemaChanges,
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

function expectDraftGenerationOutput(output: Record<string, unknown>): void {
  expect(output).toEqual(
    expect.objectContaining({
      outputKind: "draft",
      readOnly: true,
      writesToFileSystem: false,
      connectsToDatabase: false,
      executesSql: false,
    }),
  );
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

  it("finds columns across tables with filters and paging", async () => {
    const parsed = await parseSampleA5er();

    const output = findA5sqlColumns(parsed, {
      query: "ユーザー",
      onlyForeignKeyLike: true,
      limit: 10,
    }) as {
      totalColumnCount: number;
      columns: Array<{ table: string; name: string; matchedBy: string[] }>;
    };

    expect(output.totalColumnCount).toBeGreaterThanOrEqual(2);
    expect(output.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "user_profiles",
          name: "user_id",
          matchedBy: expect.arrayContaining(["columnLogicalName"]),
        }),
        expect.objectContaining({
          table: "orders",
          name: "user_id",
        }),
      ]),
    );
  });

  it("explains a table with column profile and relationships", async () => {
    const parsed = await parseSampleA5er();

    const output = explainA5sqlTable(parsed, { tableName: "users" }) as {
      found: boolean;
      summary: string;
      columnProfile: { primaryKeyColumns: Array<{ name: string }> };
      relationships: { totalCount: number; tables: Array<{ table: string; direction: string }> };
    };

    expect(output.found).toBe(true);
    expect(output.summary).toContain("users");
    expect(output.columnProfile.primaryKeyColumns).toEqual([
      expect.objectContaining({ name: "id" }),
    ]);
    expect(output.relationships.totalCount).toBe(2);
    expect(output.relationships.tables).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: "orders", direction: "outgoing" })]),
    );
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

    expectDraftGenerationOutput(output as Record<string, unknown>);
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

  it("suggests actionable schema changes from review issues", async () => {
    const parsed = await parseSampleA5er();

    const output = suggestSchemaChanges(parsed, { includeInfo: false }) as {
      suggestionCount: number;
      suggestions: Array<{ category: string; table?: string; column?: string; action: string }>;
    };

    expect(output.suggestionCount).toBeGreaterThanOrEqual(3);
    expect(output.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "primary_key",
          table: "audit_logs",
        }),
        expect.objectContaining({
          category: "data_type",
          table: "audit_logs",
          column: "details",
        }),
        expect.objectContaining({
          category: "relationship",
          table: "audit_logs",
          column: "user_id",
        }),
      ]),
    );
  });

  it("compares parsed a5er schema with a live schema snapshot", async () => {
    const parsed = await parseSampleA5er();

    const output = compareA5erWithLiveSchema(parsed, {
      liveSchema: {
        dialect: "postgresql",
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", dataType: "bigint", nullable: false, primaryKey: true },
              {
                name: "email",
                dataType: "character varying(255)",
                nullable: false,
                primaryKey: false,
              },
              {
                name: "created_at",
                dataType: "timestamp without time zone",
                nullable: false,
                primaryKey: false,
              },
            ],
          },
          {
            name: "user_profiles",
            columns: [
              { name: "user_id", dataType: "bigint", nullable: false, primaryKey: true },
              { name: "phone_number", dataType: "text", nullable: true, primaryKey: false },
            ],
          },
          {
            name: "orders",
            columns: [
              { name: "id", dataType: "bigint", nullable: false, primaryKey: false },
              { name: "user_id", dataType: "bigint", nullable: true, primaryKey: false },
            ],
          },
          {
            name: "sessions",
            columns: [{ name: "id", dataType: "uuid", nullable: false, primaryKey: true }],
          },
        ],
      },
    }) as {
      found: boolean;
      liveDialect: string;
      matchedTableCount: number;
      summary: { error: number; warning: number; info: number };
      issues: Array<{
        severity: string;
        code: string;
        table?: string;
        column?: string;
        a5er?: { normalizedDataType?: string };
        live?: { normalizedDataType?: string };
      }>;
    };

    expect(output.found).toBe(true);
    expect(output.liveDialect).toBe("postgresql");
    expect(output.matchedTableCount).toBe(3);
    expect(output.summary.error).toBeGreaterThanOrEqual(3);
    expect(output.summary.warning).toBeGreaterThanOrEqual(4);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "table_missing_in_live",
          table: "audit_logs",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "column_extra_in_live",
          table: "users",
          column: "created_at",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "column_data_type_mismatch",
          table: "user_profiles",
          column: "phone_number",
          a5er: expect.objectContaining({ normalizedDataType: "varchar(30)" }),
          live: expect.objectContaining({ normalizedDataType: "text" }),
        }),
        expect.objectContaining({
          severity: "error",
          code: "column_primary_key_mismatch",
          table: "orders",
          column: "id",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "column_nullable_mismatch",
          table: "orders",
          column: "user_id",
        }),
        expect.objectContaining({
          severity: "error",
          code: "column_missing_in_live",
          table: "orders",
          column: "order_number",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "table_extra_in_live",
          table: "sessions",
        }),
      ]),
    );
  });

  it("generates migration plan suggestions from live schema differences", async () => {
    const parsed = await parseSampleA5er();

    const output = generateMigrationPlan(parsed, {
      liveSchema: {
        dialect: "postgresql",
        tables: [
          {
            name: "users",
            columns: [{ name: "id", dataType: "bigint", nullable: false, primaryKey: true }],
          },
        ],
      },
      tableNames: ["users", "orders"],
      maxOperations: 5,
    }) as {
      operationCount: number;
      operations: Array<{ kind: string; table: string; column?: string; statements: string[] }>;
      plan: string;
    };

    expectDraftGenerationOutput(output as Record<string, unknown>);
    expect(output.operationCount).toBeGreaterThanOrEqual(2);
    expect(output.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add_column",
          table: "users",
          column: "email",
        }),
        expect.objectContaining({
          kind: "create_table",
          table: "orders",
        }),
      ]),
    );
    expect(output.plan).toContain("Migration Plan");
    expect(output.operations[0]?.statements.join("\n")).toContain("ALTER TABLE");
  });

  it("generates Markdown schema documentation", async () => {
    const parsed = await parseSampleA5er();

    const output = generateSchemaMarkdown(parsed, {
      tableNames: ["users", "orders"],
    }) as {
      tableCount: number;
      markdown: string;
      warnings: string[];
    };

    expectDraftGenerationOutput(output as Record<string, unknown>);
    expect(output.tableCount).toBe(2);
    expect(output.warnings).toEqual([]);
    expect(output.markdown).toContain("# Schema Definition");
    expect(output.markdown).toContain("## users");
    expect(output.markdown).toContain("| id | ユーザーID | bigserial | yes | no |");
    expect(output.markdown).toContain("| users | id | orders | user_id | places orders |");
  });

  it("does not expose live schema defaultValue values in compare output", async () => {
    const parsed = await parseSampleA5er();
    const secretDefault = "sk_live_secret_default_value";

    const output = compareA5erWithLiveSchema(parsed, {
      liveSchema: {
        dialect: "postgresql",
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", dataType: "bigint", nullable: false, primaryKey: true },
              {
                name: "api_token",
                dataType: "text",
                nullable: false,
                defaultValue: secretDefault,
              },
            ],
          },
        ],
      },
      tableNames: ["users"],
    });

    expect(JSON.stringify(output)).not.toContain(secretDefault);
  });

  it("keeps destructive migration operations opt-in", async () => {
    const parsed = await parseSampleA5er();

    const defaultOutput = generateMigrationPlan(parsed, {
      liveSchema: {
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", dataType: "bigint", nullable: false, primaryKey: true },
              { name: "legacy_token", dataType: "text", nullable: true },
            ],
          },
          {
            name: "legacy_sessions",
            columns: [{ name: "id", dataType: "bigint", nullable: false, primaryKey: true }],
          },
        ],
      },
      tableNames: ["users"],
    }) as {
      includeDestructive: boolean;
      operations: Array<{ destructive: boolean; kind: string }>;
      warnings: string[];
    };

    expectDraftGenerationOutput(defaultOutput as Record<string, unknown>);
    expect(defaultOutput.includeDestructive).toBe(false);
    expect(defaultOutput.operations.every((operation) => operation.destructive === false)).toBe(
      true,
    );
    expect(defaultOutput.operations.map((operation) => operation.kind)).not.toContain(
      "drop_column",
    );
    expect(defaultOutput.warnings).toContain("extra_live_column_skipped:users.legacy_token");

    const destructiveOutput = generateMigrationPlan(parsed, {
      liveSchema: {
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", dataType: "bigint", nullable: false, primaryKey: true },
              { name: "legacy_token", dataType: "text", nullable: true },
            ],
          },
        ],
      },
      tableNames: ["users"],
      includeDestructive: true,
    }) as {
      includeDestructive: boolean;
      operations: Array<{ destructive: boolean; kind: string; column?: string }>;
    };

    expectDraftGenerationOutput(destructiveOutput as Record<string, unknown>);
    expect(destructiveOutput.includeDestructive).toBe(true);
    expect(destructiveOutput.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destructive: true,
          kind: "drop_column",
          column: "legacy_token",
        }),
      ]),
    );
  });

  it("counts all compare issues while returning at most maxIssues entries", async () => {
    const parsed = await parseSampleA5er();

    const output = compareA5erWithLiveSchema(parsed, {
      liveSchema: {
        tables: [],
      },
      maxIssues: 2,
    }) as {
      issueCount: number;
      truncated: boolean;
      maxIssues: number;
      summary: { error: number; warning: number; info: number };
      issues: Array<{ code: string }>;
    };

    expect(output.maxIssues).toBe(2);
    expect(output.issues).toHaveLength(2);
    expect(output.issues.length).toBeLessThanOrEqual(output.maxIssues);
    expect(output.issueCount).toBe(4);
    expect(output.truncated).toBe(true);
    expect(output.summary).toEqual({ error: 4, warning: 0, info: 0 });
  });

  it("rejects live schema input above the total column limit", () => {
    const liveSchema = {
      tables: Array.from({ length: 11 }, (_, tableIndex) => ({
        name: `table_${tableIndex}`,
        columns: Array.from({ length: 2000 }, (_, columnIndex) => ({
          name: `column_${tableIndex}_${columnIndex}`,
        })),
      })),
    };

    const result = compareA5erWithLiveSchemaInputSchema.liveSchema.safeParse(liveSchema);

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("総カラム数"),
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

    expectDraftGenerationOutput(output as Record<string, unknown>);
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

    expectDraftGenerationOutput(output as Record<string, unknown>);
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
    expectDraftGenerationOutput(models as Record<string, unknown>);
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
    expectDraftGenerationOutput(select as Record<string, unknown>);
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
