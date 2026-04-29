import { describe, it, expect, vi, beforeEach } from "vitest";
import { batchCreateMenuItems } from "../batchCreateMenuItems";
import type { DraftRow, FoodCategory, FoodTag } from "@/types/database";

// Mock the api module
vi.mock("@/lib/api", () => ({
  createMenuItem: vi.fn(),
  setMenuItemCategories: vi.fn().mockResolvedValue(true),
  setMenuItemTags: vi.fn().mockResolvedValue(true),
}));

import { createMenuItem, setMenuItemCategories, setMenuItemTags } from "@/lib/api";

const mockCreateMenuItem = createMenuItem as any;
const mockSetCategories = setMenuItemCategories as any;
const mockSetTags = setMenuItemTags as any;

function makeDraftRow(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    name: "Test Item",
    price: "100",
    description: "",
    imageUrl: "",
    categoryNames: [],
    tagNames: [],
    is_available: true,
    _id: crypto.randomUUID(),
    _errors: {},
    _status: "idle",
    ...overrides,
  };
}

const cats: FoodCategory[] = [];
const tags: FoodTag[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockSetCategories.mockResolvedValue(true);
  mockSetTags.mockResolvedValue(true);
});

describe("batchCreateMenuItems", () => {
  it("succeeds for all rows — postcondition: succeeded + failed === rows.length", async () => {
    mockCreateMenuItem
      .mockResolvedValueOnce({ id: "item1", restaurant_id: "r1", name: "Item 1", price: 100, is_available: true })
      .mockResolvedValueOnce({ id: "item2", restaurant_id: "r1", name: "Item 2", price: 200, is_available: true });

    const rows = [makeDraftRow({ name: "Item 1", price: "100" }), makeDraftRow({ name: "Item 2", price: "200" })];
    const result = await batchCreateMenuItems({ restaurantId: "r1", rows, categories: cats, tags });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.succeeded + result.failed).toBe(rows.length);
  });

  it("handles partial failure — failed rows don't abort remaining rows", async () => {
    mockCreateMenuItem
      .mockResolvedValueOnce({ id: "item1", restaurant_id: "r1", name: "Item 1", price: 100, is_available: true })
      .mockResolvedValueOnce(null) // failure
      .mockResolvedValueOnce({ id: "item3", restaurant_id: "r1", name: "Item 3", price: 300, is_available: true });

    const rows = [makeDraftRow(), makeDraftRow(), makeDraftRow()];
    const result = await batchCreateMenuItems({ restaurantId: "r1", rows, categories: cats, tags });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowIndex).toBe(1);
    expect(result.succeeded + result.failed).toBe(rows.length);
  });

  it("handles all rows failing", async () => {
    mockCreateMenuItem.mockResolvedValue(null);

    const rows = [makeDraftRow(), makeDraftRow()];
    const result = await batchCreateMenuItems({ restaurantId: "r1", rows, categories: cats, tags });

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.succeeded + result.failed).toBe(rows.length);
  });

  it("calls setMenuItemCategories and setMenuItemTags for each successful item", async () => {
    mockCreateMenuItem.mockResolvedValue({ id: "item1", restaurant_id: "r1", name: "Item", price: 100, is_available: true });

    const rows = [makeDraftRow()];
    await batchCreateMenuItems({ restaurantId: "r1", rows, categories: cats, tags });

    expect(mockSetCategories).toHaveBeenCalledWith("item1", []);
    expect(mockSetTags).toHaveBeenCalledWith("item1", []);
  });

  it("calls onProgress callback after each row", async () => {
    mockCreateMenuItem.mockResolvedValue({ id: "item1", restaurant_id: "r1", name: "Item", price: 100, is_available: true });

    const onProgress = vi.fn();
    const rows = [makeDraftRow(), makeDraftRow()];
    await batchCreateMenuItems({ restaurantId: "r1", rows, categories: cats, tags, onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it("handles createMenuItem throwing an error", async () => {
    mockCreateMenuItem.mockRejectedValueOnce(new Error("Network error"));

    const rows = [makeDraftRow()];
    const result = await batchCreateMenuItems({ restaurantId: "r1", rows, categories: cats, tags });

    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toBe("Network error");
  });
});

