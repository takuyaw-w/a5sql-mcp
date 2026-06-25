import { describe, expect, it } from "vitest";

import { parseA5erIni } from "../src/index.js";

describe("parseA5erIni", () => {
  it("extracts entities, fields, indexes, positions, and relations", () => {
    const parsed = parseA5erIni(`
      # A5:ER FORMAT:19
      # A5:ER ENCODING:UTF8

      [Manager]
      ProjectName="Sample"
      PageInfo="Main",3,"A4Landscape",$FFFFFF

      [Entity]
      PName=users
      LName=ユーザー
      Field="ユーザーID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""
      Field="ユーザー名","user_name","varchar(100)","NOT NULL",,"","",$FFFFFFFF,""
      Index=users_ix1=0,user_name
      Position="MAIN",2350,800

      [Entity]
      PName=orders
      LName=注文
      Field="注文ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""
      Field="ユーザーID","user_id","Integer","NOT NULL",,"","",$FFFFFFFF,""

      [Relation]
      Entity1=users
      Entity2=orders
      Fields1=id
      Fields2=user_id
      RelationType1=2
      RelationType2=3
    `);

    expect(parsed.formatVersion).toBe(19);
    expect(parsed.manager.ProjectName).toBe("Sample");
    expect(parsed.tables).toHaveLength(2);
    expect(parsed.tables[0]?.name).toBe("users");
    expect(parsed.tables[0]?.logicalName).toBe("ユーザー");
    expect(parsed.tables[0]?.columns.map((column) => column.name)).toEqual(["id", "user_name"]);
    expect(parsed.tables[0]?.columns[0]?.primaryKey).toBe(true);
    expect(parsed.tables[0]?.indexes[0]?.columns).toEqual(["user_name"]);
    expect(parsed.tables[0]?.positions[0]?.page).toBe("MAIN");
    expect(parsed.relationships[0]?.entity1).toBe("users");
    expect(parsed.relationships[0]?.entity2).toBe("orders");
    expect(parsed.relationships[0]?.fields2).toEqual(["user_id"]);
  });

  it("decodes A5 escaped strings inside complex values", () => {
    const parsed = parseA5erIni(`
      [Entity]
      PName=notes
      Field="引用\\Qあり","quote_col","varchar(20)","",,,"line\\nbreak",$FFFFFFFF,""
    `);

    expect(parsed.tables[0]?.columns[0]?.logicalName).toBe("引用\"あり");
    expect(parsed.tables[0]?.columns[0]?.comment).toBe("line\nbreak");
  });
});
