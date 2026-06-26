import { z } from "zod";

const MAX_LIVE_SCHEMA_TABLES = 2000;
const MAX_LIVE_SCHEMA_COLUMNS_PER_TABLE = 2000;
const MAX_LIVE_SCHEMA_TOTAL_COLUMNS = 20000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_DATA_TYPE_LENGTH = 256;
const MAX_DEFAULT_VALUE_LENGTH = 1024;
const MAX_DIALECT_LENGTH = 50;

const liveSchemaColumnInputSchema = z.object({
  name: z.string().min(1).max(MAX_IDENTIFIER_LENGTH).describe("カラム名。"),
  dataType: z.string().min(1).max(MAX_DATA_TYPE_LENGTH).optional().describe("DB 上のデータ型。"),
  nullable: z.boolean().optional().describe("DB 上で NULL 許容か。"),
  primaryKey: z.boolean().optional().describe("DB 上で主キーか。"),
  defaultValue: z
    .string()
    .max(MAX_DEFAULT_VALUE_LENGTH)
    .optional()
    .describe("DB 上の default 値。"),
});

const liveSchemaTableInputSchema = z.object({
  name: z.string().min(1).max(MAX_IDENTIFIER_LENGTH).describe("live schema 側のテーブル名。"),
  schema: z.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional().describe("任意。スキーマ名。"),
  type: z.enum(["table", "view"]).optional().describe("任意。table または view。"),
  columns: z
    .array(liveSchemaColumnInputSchema)
    .max(MAX_LIVE_SCHEMA_COLUMNS_PER_TABLE)
    .describe("live schema 側のカラム一覧。"),
});

const liveSchemaInputSchema = z
  .object({
    dialect: z
      .string()
      .min(1)
      .max(MAX_DIALECT_LENGTH)
      .optional()
      .describe("任意。postgresql, mysql, sqlserver, sqlite などの方言名。"),
    tables: z
      .array(liveSchemaTableInputSchema)
      .max(MAX_LIVE_SCHEMA_TABLES)
      .describe("live schema 側のテーブル一覧。"),
  })
  .superRefine((schema, context) => {
    let totalColumns = 0;
    for (const table of schema.tables) {
      totalColumns += table.columns.length;
      if (totalColumns > MAX_LIVE_SCHEMA_TOTAL_COLUMNS) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          origin: "array",
          maximum: MAX_LIVE_SCHEMA_TOTAL_COLUMNS,
          inclusive: true,
          path: ["tables"],
          message: `live schema の総カラム数は ${MAX_LIVE_SCHEMA_TOTAL_COLUMNS} 件以下にしてください。`,
        });
        return;
      }
    }
  })
  .describe("外部 DB MCP などから取得した live schema のスナップショット。");

export const compareA5erWithLiveSchemaInputSchema = {
  liveSchema: liveSchemaInputSchema,
  tableNames: z
    .array(z.string().min(1).max(MAX_IDENTIFIER_LENGTH))
    .max(100)
    .optional()
    .describe("任意。物理名または論理名で比較対象テーブルを絞ります。"),
  compareDataTypes: z.boolean().optional().describe("型差分を比較します。省略時は true。"),
  compareNullable: z.boolean().optional().describe("NULL 許容差分を比較します。省略時は true。"),
  comparePrimaryKeys: z.boolean().optional().describe("主キー差分を比較します。省略時は true。"),
  includeExtraLiveTables: z
    .boolean()
    .optional()
    .describe("live schema 側にだけあるテーブルを issue に含めます。省略時は true。"),
  maxIssues: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("返す issue の最大件数。省略時は 200。"),
};
