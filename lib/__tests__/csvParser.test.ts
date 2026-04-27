import { parseCSV, generateCSVTemplate, buildNameMap } from "../csvParser";
import type { FoodCategory, FoodTag } from "@/types/database";

const mockCats: FoodCategory[] = [
  { id: "c1", restaurant_id: "r1", parent_id: null, name: "Mains", description: null, image_url: null, color: "#f00", sort_order: 0, is_suggestion: false, created_at: "" },
  { id: "c2", restaurant_id: "r1", parent_id: null, name: "Starters", description: null, image_url: null, color: "#0f0", sort_order: 1, is_suggestion: false, created_at: "" },
];

const mockTags: FoodTag[] = [
  { id: "t1", restaurant_id: "r1", name: "Veg", description: null, image_url: null, color: "#0f0", sort_order: 0, is_suggestion: false, created_at: "" },
  { id: "t2", restaurant_id: "r1", name: "Spicy", description: null, image_url: null, color: "#f00", sort_order: 1, is_suggestion: false, created_at: "" },
];

describe("buildNameMap", () => {
  it("builds a lowercase name → id map", () => {
    const map = buildNameMap(mockCats);
    expect(map.get("mains")).toBe("c1");
    expect(map.get("starters")).toBe("c2");
    expect(map.has("unknown")).toBe(false);
  });
});

describe("parseCSV", () => {
  it("parses a valid CSV with all fields", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,250,Fragrant rice,Mains,Veg,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].name).toBe("Biryani");
    expect(result.rows[0].price).toBe("250");
    expect(result.rows[0].categoryNames).toEqual(["Mains"]);
    expect(result.rows[0].tagNames).toEqual(["Veg"]);
    expect(result.rows[0].is_available).toBe(true);
  });

  it("returns error for missing name", () => {
    const csv = `name,price,description,categories,tags,is_available\n,250,desc,,Veg,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.errors.some((e) => e.field === "name")).toBe(true);
    expect(result.rows[0]._errors.name).toBeTruthy();
  });

  it("returns error for invalid price", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,abc,desc,,Veg,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.errors.some((e) => e.field === "price")).toBe(true);
  });

  it("returns error for zero price", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,0,desc,,,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.errors.some((e) => e.field === "price")).toBe(true);
  });

  it("skips comment rows starting with #", () => {
    const csv = `name,price,description,categories,tags,is_available\n# Available categories: Mains\nBiryani,250,,,Veg,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Biryani");
  });

  it("skips blank lines", () => {
    const csv = `name,price,description,categories,tags,is_available\n\nBiryani,250,,,Veg,true\n\n`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows).toHaveLength(1);
  });

  it("silently drops unknown category names", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,250,,UnknownCat,Veg,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows[0].categoryNames).toEqual([]);
    expect(result.errors.some((e) => e.field === "categories")).toBe(false);
  });

  it("silently drops unknown tag names", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,250,,,UnknownTag,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows[0].tagNames).toEqual([]);
  });

  it("handles pipe-separated categories and tags", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,250,,Mains | Starters,Veg | Spicy,true`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows[0].categoryNames).toEqual(["Mains", "Starters"]);
    expect(result.rows[0].tagNames).toEqual(["Veg", "Spicy"]);
  });

  it("defaults is_available to true when blank", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,250,,,,`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows[0].is_available).toBe(true);
  });

  it("parses is_available false correctly", () => {
    const csv = `name,price,description,categories,tags,is_available\nBiryani,250,,,,false`;
    const result = parseCSV(csv, mockCats, mockTags);
    expect(result.rows[0].is_available).toBe(false);
  });

  it("returns error when no data rows found", () => {
    const result = parseCSV("", mockCats, mockTags);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("assigns unique _id to each row", () => {
    const csv = `name,price,description,categories,tags,is_available\nItem1,100,,,, \nItem2,200,,,,`;
    const result = parseCSV(csv, mockCats, mockTags);
    const ids = result.rows.map((r) => r._id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("generateCSVTemplate", () => {
  it("includes the correct header row", () => {
    const csv = generateCSVTemplate([], []);
    const firstLine = csv.split(/\r?\n/)[0];
    expect(firstLine).toBe("name,price,description,categories,tags,is_available");
  });

  it("includes category comment when categories exist", () => {
    const csv = generateCSVTemplate(mockCats, []);
    expect(csv).toContain("# Available categories:");
    expect(csv).toContain("Mains");
    expect(csv).toContain("Starters");
  });

  it("includes tag comment when tags exist", () => {
    const csv = generateCSVTemplate([], mockTags);
    expect(csv).toContain("# Available tags:");
    expect(csv).toContain("Veg");
  });

  it("omits category comment when no categories", () => {
    const csv = generateCSVTemplate([], mockTags);
    expect(csv).not.toContain("# Available categories:");
  });

  it("omits tag comment when no tags", () => {
    const csv = generateCSVTemplate(mockCats, []);
    expect(csv).not.toContain("# Available tags:");
  });
});
