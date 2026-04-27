import Papa from "papaparse";
import type { DraftRow, FoodCategory, FoodTag } from "@/types/database";

export const CSV_COLUMNS = ["name", "price", "description", "image_url", "categories", "tags", "is_available"] as const;

export interface ParseError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface ParseResult {
  rows: DraftRow[];
  errors: ParseError[];
}

export function buildNameMap(items: Array<{ id: string; name: string }>): Map<string, string> {
  const map = new Map<string, string>();
  items.forEach((item) => map.set(item.name.toLowerCase().trim(), item.id));
  return map;
}

export function generateCSVTemplate(categories: FoodCategory[], tags: FoodTag[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines: string[] = [header];

  if (categories.length > 0) {
    lines.push(`# Available categories: ${categories.map((c) => c.name).join(" | ")}`);
  }
  if (tags.length > 0) {
    lines.push(`# Available tags: ${tags.map((t) => t.name).join(" | ")}`);
  }

  lines.push("# Separate multiple categories/tags with | (pipe). is_available: true or false. image_url is optional.");
  lines.push("Margherita Pizza,299,Classic tomato and mozzarella,,Veg,true,https://example.com/pizza.jpg");

  return lines.join("\n");
}

function parseBoolean(val: string | undefined): boolean {
  if (!val) return true;
  const v = val.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function parseCSV(
  csvText: string,
  categories: FoodCategory[],
  tags: FoodTag[]
): ParseResult {
  const rows: DraftRow[] = [];
  const errors: ParseError[] = [];

  const catMap = buildNameMap(categories);
  const tagMap = buildNameMap(tags);

  // Strip comment lines before passing to papaparse
  const cleanedLines = csvText
    .split("\n")
    .filter((line) => !line.trim().startsWith("#") && line.trim() !== "");
  const cleanedText = cleanedLines.join("\n");

  const result = Papa.parse<Record<string, string>>(cleanedText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (!result.data || result.data.length === 0) {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No data rows found in CSV" }] };
  }

  result.data.forEach((record, i) => {
    const rowErrors: Record<string, string> = {};

    const name = (record["name"] ?? "").trim();
    const priceRaw = (record["price"] ?? "").trim();
    const description = (record["description"] ?? "").trim();
    const imageUrl = (record["image_url"] ?? "").trim();
    const categoriesRaw = (record["categories"] ?? "").trim();
    const tagsRaw = (record["tags"] ?? "").trim();
    const isAvailableRaw = (record["is_available"] ?? "").trim();

    if (!name) {
      rowErrors["name"] = "Name is required";
      errors.push({ rowIndex: i, field: "name", message: "Name is required" });
    }

    const priceNum = parseFloat(priceRaw);
    if (!priceRaw || isNaN(priceNum) || priceNum <= 0) {
      rowErrors["price"] = "Price must be a positive number";
      errors.push({ rowIndex: i, field: "price", message: "Price must be a positive number" });
    }

    // Resolve category names — unknown silently dropped
    const categoryNames = categoriesRaw
      ? categoriesRaw.split("|").map((s) => s.trim()).filter((s) => s && catMap.has(s.toLowerCase()))
      : [];

    // Resolve tag names — unknown silently dropped
    const tagNames = tagsRaw
      ? tagsRaw.split("|").map((s) => s.trim()).filter((s) => s && tagMap.has(s.toLowerCase()))
      : [];

    rows.push({
      name,
      price: priceRaw,
      description,
      imageUrl,
      categoryNames,
      tagNames,
      is_available: parseBoolean(isAvailableRaw),
      _id: crypto.randomUUID(),
      _errors: rowErrors,
      _status: "idle",
    });
  });

  return { rows, errors };
}
