export type ParsedA5erDocument = {
  parseStatus: "ok" | "unrecognized";
  formatVersion?: number;
  encoding?: string;
  fileEncoding?: string;
  manager: Record<string, unknown>;
  tables: ParsedA5erTable[];
  relationships: ParsedA5erRelationship[];
  warnings: string[];
};

export type ParsedA5erTable = {
  objectType: "entity" | "view";
  name: string;
  logicalName?: string;
  physicalName?: string;
  comment?: string;
  columns: ParsedA5erColumn[];
  indexes: ParsedA5erIndex[];
  positions: ParsedA5erPosition[];
};

export type ParsedA5erColumn = {
  name: string;
  logicalName?: string;
  physicalName?: string;
  dataType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  keyOrder?: number;
  defaultValue?: string;
  comment?: string;
  option?: string;
};

export type ParsedA5erIndex = {
  name?: string;
  unique: boolean;
  uniqueType: number;
  columns: string[];
};

export type ParsedA5erPosition = {
  page: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type ParsedA5erRelationship = {
  name?: string;
  entity1?: string;
  entity2?: string;
  fields1: string[];
  fields2: string[];
  relationType1?: number;
  relationType2?: number;
  caption?: string;
};
