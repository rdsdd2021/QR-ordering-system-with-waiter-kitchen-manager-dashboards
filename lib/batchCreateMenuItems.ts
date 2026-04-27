import { createMenuItem, setMenuItemCategories, setMenuItemTags } from "@/lib/api";
import { buildNameMap } from "@/lib/csvParser";
import type { DraftRow, FoodCategory, FoodTag } from "@/types/database";

export interface BatchCreateParams {
  restaurantId: string;
  rows: DraftRow[];
  categories: FoodCategory[];
  tags: FoodTag[];
  onProgress?: (saved: number, total: number) => void;
}

export interface BatchCreateResult {
  succeeded: number;
  failed: number;
  errors: Array<{ rowIndex: number; message: string }>;
}

export async function batchCreateMenuItems(params: BatchCreateParams): Promise<BatchCreateResult> {
  const { restaurantId, rows, categories, tags, onProgress } = params;

  const categoryMap = buildNameMap(categories);
  const tagMap = buildNameMap(tags);

  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ rowIndex: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const item = await createMenuItem({
        restaurantId,
        name: row.name.trim(),
        price: parseFloat(row.price),
        description: row.description.trim() || null,
        image_url: row.imageUrl?.trim() || null,
        tags: null,
      });

      if (!item) throw new Error("createMenuItem returned null");

      const categoryIds = row.categoryNames
        .map((n) => categoryMap.get(n.toLowerCase()))
        .filter((id): id is string => !!id);

      const tagIds = row.tagNames
        .map((n) => tagMap.get(n.toLowerCase()))
        .filter((id): id is string => !!id);

      await Promise.all([
        setMenuItemCategories(item.id, categoryIds),
        setMenuItemTags(item.id, tagIds),
      ]);

      succeeded++;
    } catch (err) {
      failed++;
      errors.push({
        rowIndex: i,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    onProgress?.(succeeded + failed, rows.length);
  }

  // Postcondition: succeeded + failed === rows.length
  return { succeeded, failed, errors };
}
