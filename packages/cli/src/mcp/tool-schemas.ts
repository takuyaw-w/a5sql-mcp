import { z } from "zod";

import { compareA5erWithLiveSchemaInputSchema } from "./schema-compare/schemas.js";

export const describeA5sqlFileInputSchema = {};

export const parseA5sqlFileInputSchema = {
  mode: z
    .enum(["summary", "full"])
    .optional()
    .describe(
      "summary は件数と代表例だけを返します。full は解析結果全体を返します。省略時は summary。",
    ),
  summaryLimit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("summary で返す代表要素の最大件数。省略時は 20。"),
  maxTables: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("full で返すテーブルの最大件数。省略時は 100。"),
  maxRelationships: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("full で返すリレーションの最大件数。省略時は 200。"),
  maxColumnsPerTable: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("full で各テーブルに返すカラムの最大件数。省略時は 100。"),
};

export const readA5sqlFileInputSchema = {
  maxChars: z
    .number()
    .int()
    .min(1)
    .max(500_000)
    .optional()
    .describe("返す最大文字数。省略時は 100000。"),
  offsetChars: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("読み取り開始位置を文字数で指定します。省略時は 0。"),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("読み取り開始行を 1 始まりで指定します。指定時は offsetChars より優先します。"),
  maxLines: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .describe("startLine 指定時に返す最大行数。省略時は maxChars の範囲で返します。"),
};

export const listA5sqlTablesInputSchema = {
  offset: z.number().int().min(0).optional().describe("返却開始位置。省略時は 0。"),
  limit: z.number().int().min(1).max(500).optional().describe("返す最大件数。省略時は 100。"),
};

export const describeA5sqlTableInputSchema = {
  tableName: z.string().min(1).describe("物理名または論理名。大文字小文字は区別しません。"),
};

export const explainA5sqlTableInputSchema = {
  tableName: z.string().min(1).describe("説明対象テーブルの物理名または論理名。"),
  maxRelatedTables: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("返す関連テーブルの最大数。省略時は 10。"),
};

export const listA5sqlRelationshipsInputSchema = {
  tableName: z
    .string()
    .min(1)
    .optional()
    .describe(
      "任意。物理名または論理名で指定すると、そのテーブルに関係するリレーションだけを返します。",
    ),
};

export const findA5sqlTablesInputSchema = {
  query: z.string().min(1).optional().describe("検索語。省略時は全テーブルを返します。"),
  limit: z.number().int().min(1).max(100).optional().describe("最大件数。省略時は 20。"),
};

export const findA5sqlColumnsInputSchema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("任意。カラム名、論理名、コメント、型、テーブル名から検索します。"),
  tableNames: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe("任意。物理名または論理名で検索対象テーブルを絞ります。"),
  dataType: z.string().min(1).max(100).optional().describe("任意。データ型で絞ります。"),
  onlyPrimaryKeys: z.boolean().optional().describe("true の場合、主キー列だけを返します。"),
  onlyForeignKeyLike: z
    .boolean()
    .optional()
    .describe("true の場合、*_id など外部キーらしい列だけを返します。"),
  offset: z.number().int().min(0).optional().describe("返却開始位置。省略時は 0。"),
  limit: z.number().int().min(1).max(500).optional().describe("返す最大件数。省略時は 100。"),
};

export const generateSqlSelectInputSchema = {
  tableName: z
    .string()
    .min(1)
    .describe("起点テーブルの物理名または論理名。大文字小文字は区別しません。"),
  includeRelations: z
    .boolean()
    .optional()
    .describe("true の場合、直接リレーションしているテーブルを LEFT JOIN します。"),
  relatedTables: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("任意。includeRelations=true のときに JOIN 対象を物理名または論理名で絞ります。"),
  whereColumns: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe(
      "任意。起点テーブルの WHERE 条件として使うカラム名。各カラムは :column_name パラメータになります。",
    ),
  limit: z.number().int().min(1).max(10000).optional().describe("任意。LIMIT 句を追加します。"),
  maxRelatedTables: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("includeRelations=true のときに JOIN する関連テーブルの最大数。省略時は 10。"),
};

export const generateMermaidErDiagramInputSchema = {
  tableNames: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe("任意。物理名または論理名で出力対象テーブルを絞ります。"),
  includeViews: z.boolean().optional().describe("true の場合、View も出力します。省略時は true。"),
  includeColumns: z
    .boolean()
    .optional()
    .describe("true の場合、各テーブルのカラムも出力します。省略時は true。"),
  maxTables: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("出力するテーブルの最大数。省略時は 100。"),
};

export const generateModelFilesInputSchema = {
  framework: z
    .enum(["laravel", "sqlalchemy"])
    .describe("生成するモデル形式。laravel または sqlalchemy。"),
  tableNames: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe("任意。物理名または論理名で生成対象テーブルを絞ります。"),
  maxTables: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("モデル生成するテーブルの最大数。省略時は 20。"),
};

export const reviewA5sqlSchemaInputSchema = {
  maxIssues: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("返す issue の最大件数。省略時は 100。"),
  includeInfo: z
    .boolean()
    .optional()
    .describe("true の場合、コメント不足などの info issue も返します。省略時は true。"),
};

export const suggestSchemaChangesInputSchema = {
  maxSuggestions: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("返す改善提案の最大件数。省略時は 100。"),
  includeInfo: z
    .boolean()
    .optional()
    .describe("true の場合、コメント不足など低優先度の提案も含めます。省略時は true。"),
};

export const compareA5erWithLiveSchemaToolInputSchema = compareA5erWithLiveSchemaInputSchema;

export const generateMigrationPlanInputSchema = {
  ...compareA5erWithLiveSchemaInputSchema,
  style: z
    .enum(["plain_sql", "laravel", "alembic"])
    .optional()
    .describe("生成する migration 案の形式。省略時は plain_sql。"),
  includeDestructive: z
    .boolean()
    .optional()
    .describe("true の場合、live schema にだけあるテーブル/カラムの DROP 案も含めます。"),
  maxOperations: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("返す migration operation の最大件数。省略時は 100。"),
};

export const generateSchemaMarkdownInputSchema = {
  tableNames: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe("任意。物理名または論理名で出力対象テーブルを絞ります。"),
  includeRelationships: z
    .boolean()
    .optional()
    .describe("true の場合、対象テーブル間のリレーション表を含めます。省略時は true。"),
  includeViews: z.boolean().optional().describe("true の場合、View も出力します。省略時は true。"),
  maxTables: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("出力するテーブルの最大数。省略時は 100。"),
  maxColumnsPerTable: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("各テーブルで出力するカラムの最大数。省略時は 100。"),
};
