import { describe, expect, it } from "vitest";
import {
  BlockSchema,
  ComponentSchema,
  DesignDocSchema,
  PageSchema,
  SectionSchema,
  type DesignDoc,
} from "./schema";

/**
 * `DesignDocSchema` is the only gate between a language model's output and the
 * compiler, so what it accepts and rejects is a contract, not an
 * implementation detail. These specs pin that contract at the barrel — the
 * surface every consumer imports — so the schema can be reorganised freely
 * underneath as long as validation behaviour is unchanged.
 */

/** The smallest document the schema should accept. */
const MINIMAL: DesignDoc = {
  version: "1",
  brand: {
    colors: { bg: "#ffffff", text: "#0b1120", primary: "#6366f1" },
    type: { h1: { size: 48, weight: 700 }, body: { size: 16 } },
  },
  pages: [
    {
      name: "Home",
      sections: [{ role: "hero", headline: "Ship design, not screenshots" }],
    },
  ],
};

describe("DesignDocSchema", () => {
  it("accepts a minimal document", () => {
    expect(DesignDocSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it("round-trips a document unchanged", () => {
    // Parse must not quietly drop or coerce authored fields — the compiler
    // reads the parsed value, so a silent drop would lose design intent.
    const parsed = DesignDocSchema.parse(MINIMAL);
    expect(parsed).toEqual(MINIMAL);
  });

  it("rejects a document with no version", () => {
    const { version: _version, ...rest } = MINIMAL;
    expect(DesignDocSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong version literal", () => {
    expect(DesignDocSchema.safeParse({ ...MINIMAL, version: "2" }).success).toBe(false);
  });

  it("rejects a document with no brand", () => {
    const { brand: _brand, ...rest } = MINIMAL;
    expect(DesignDocSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a section with an unknown role", () => {
    const bad = {
      ...MINIMAL,
      pages: [{ name: "Home", sections: [{ role: "carousel" }] }],
    };
    expect(DesignDocSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a document carrying components and a prototype flow", () => {
    const rich: DesignDoc = {
      ...MINIMAL,
      components: [
        {
          name: "Badge",
          props: [{ name: "label", type: "text" }],
          body: { type: "text", text: "@prop.label" },
        },
      ],
      prototype: { start: "Home", rotation: "portrait" },
    };
    const result = DesignDocSchema.safeParse(rich);
    expect(result.success).toBe(true);
  });
});

describe("the recursive block union", () => {
  it("validates a nested stack several levels deep", () => {
    // The block union goes through z.lazy; a broken lazy reference shows up
    // as "valid at depth 1, invalid at depth 2" rather than an import error.
    const deep = {
      type: "stack",
      children: [
        { type: "stack", children: [{ type: "stack", children: [{ type: "text", text: "hi" }] }] },
      ],
    };
    expect(BlockSchema.safeParse(deep).success).toBe(true);
  });

  it("rejects an unknown block type at any depth", () => {
    const bad = {
      type: "stack",
      children: [{ type: "stack", children: [{ type: "hologram" }] }],
    };
    expect(BlockSchema.safeParse(bad).success).toBe(false);
  });

  it("shares one recursion definition with component bodies", () => {
    const component = {
      name: "Nested",
      body: { type: "stack", children: [{ type: "text", text: "x" }] },
    };
    expect(ComponentSchema.safeParse(component).success).toBe(true);
  });
});

describe("the barrel's public surface", () => {
  it("re-exports every schema a consumer imports from `dsl/schema`", () => {
    // The split into schema/*.ts must stay invisible to callers.
    for (const schema of [
      DesignDocSchema,
      PageSchema,
      SectionSchema,
      BlockSchema,
      ComponentSchema,
    ]) {
      expect(typeof schema.safeParse).toBe("function");
    }
  });

  it("validates a page independently of the document that holds it", () => {
    expect(PageSchema.safeParse(MINIMAL.pages[0]).success).toBe(true);
  });

  it("validates a section independently of the page that holds it", () => {
    expect(SectionSchema.safeParse(MINIMAL.pages[0]!.sections[0]).success).toBe(true);
  });
});
