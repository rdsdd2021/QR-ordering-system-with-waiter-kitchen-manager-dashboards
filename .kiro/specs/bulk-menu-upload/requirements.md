# Requirements: Bulk Menu Upload

## Introduction

The Bulk Menu Upload feature allows restaurant managers to add multiple menu items at once, either by uploading a filled CSV file or by typing rows directly into an inline spreadsheet-like table. Both workflows live inside the existing `MenuManager` component as additional tabs and respect the existing subscription plan limits.

---

## Requirements

### 1. CSV Upload Workflow

#### 1.1 Template Download

**User Story**: As a restaurant manager, I want to download a CSV template so that I know exactly what format to use when preparing my menu data in Excel or Google Sheets.

**Acceptance Criteria**:

- [ ] 1.1.1 A "Download Template" button is visible in the CSV Upload tab.
- [ ] 1.1.2 Clicking the button downloads a file named `menu_template.csv`.
- [ ] 1.1.3 The template contains a header row with columns: `name`, `price`, `description`, `categories`, `tags`, `is_available`.
- [ ] 1.1.4 The template includes comment rows (lines starting with `#`) listing the restaurant's current category names and tag names so the manager knows valid values.
- [ ] 1.1.5 If no categories or tags exist, the corresponding comment row is omitted.

#### 1.2 File Upload and Parsing

**User Story**: As a restaurant manager, I want to upload a filled CSV file so that the app can read my menu data without me entering each item manually.

**Acceptance Criteria**:

- [ ] 1.2.1 A file input accepts only `.csv` files.
- [ ] 1.2.2 After selecting a file, the app parses it and displays a preview table immediately (no separate "parse" button needed).
- [ ] 1.2.3 Header rows and comment rows (lines starting with `#`) are skipped during parsing.
- [ ] 1.2.4 Blank lines in the CSV are skipped.
- [ ] 1.2.5 If the file cannot be parsed (binary file, no recognisable header), an error message is shown below the file input and no preview table is rendered.

#### 1.3 Validation

**User Story**: As a restaurant manager, I want to see validation errors highlighted in the preview so that I can fix problems before importing.

**Acceptance Criteria**:

- [ ] 1.3.1 Rows with a blank `name` field are highlighted with an error on the `name` cell.
- [ ] 1.3.2 Rows with a missing, non-numeric, zero, or negative `price` are highlighted with an error on the `price` cell.
- [ ] 1.3.3 The "Import" button is disabled while any validation errors exist in the preview.
- [ ] 1.3.4 The manager can delete individual rows from the preview to remove invalid entries.
- [ ] 1.3.5 Category and tag names that do not match any existing category/tag for the restaurant are silently dropped (not treated as errors), and the resolved names are shown in the preview.

#### 1.4 Plan Limit Enforcement

**User Story**: As a free-plan manager, I want to be warned when my import would exceed my plan's item limit so that I know I need to upgrade or reduce the batch size.

**Acceptance Criteria**:

- [ ] 1.4.1 When the number of valid rows in the preview would cause the total item count to exceed the plan limit, a warning banner is shown stating how many more items can be added.
- [ ] 1.4.2 The "Import" button is disabled when the batch would exceed the plan limit.
- [ ] 1.4.3 Pro-plan managers have no item count restriction and see no limit warning.

#### 1.5 Batch Import

**User Story**: As a restaurant manager, I want to import all valid rows at once so that I don't have to save each item individually.

**Acceptance Criteria**:

- [ ] 1.5.1 Clicking "Import N Items" triggers sequential creation of all valid rows using `createMenuItem`.
- [ ] 1.5.2 A progress indicator shows how many items have been saved out of the total (e.g., "Saving 3 / 10…").
- [ ] 1.5.3 For each successfully created item, `setMenuItemCategories` and `setMenuItemTags` are called with the resolved IDs.
- [ ] 1.5.4 If a row fails to save, it is marked with an error; processing continues for the remaining rows.
- [ ] 1.5.5 After all rows are processed, a summary is shown: "X of Y items imported successfully." with a list of any failures.
- [ ] 1.5.6 After a successful (or partial) import, `onImportComplete` is called so `MenuManager` reloads the item list.
- [ ] 1.5.7 Successfully imported rows are removed from the preview; failed rows remain so the manager can retry.

---

### 2. Inline Bulk Edit Workflow

#### 2.1 Grid Management

**User Story**: As a restaurant manager, I want to add multiple rows directly in the browser without leaving the page so that I can quickly build up a batch of new items.

**Acceptance Criteria**:

- [ ] 2.1.1 The Bulk Edit tab shows an editable table with columns: Name, Price (₹), Description, Categories, Tags, Available.
- [ ] 2.1.2 An "Add Row" button appends a new blank row to the bottom of the table.
- [ ] 2.1.3 Each row has a delete button that removes it from the table.
- [ ] 2.1.4 The table starts with one blank row when the tab is first opened.
- [ ] 2.1.5 The "Save All" button label shows the count of rows to be saved (e.g., "Save All (3 items)").

#### 2.2 Cell Editing and Validation

**User Story**: As a restaurant manager, I want inline validation feedback as I type so that I can fix errors before saving.

**Acceptance Criteria**:

- [ ] 2.2.1 The `name` cell is a text input; leaving it blank shows an inline error.
- [ ] 2.2.2 The `price` cell is a number input; entering a non-positive value shows an inline error.
- [ ] 2.2.3 The `description` cell is an optional text input with no validation.
- [ ] 2.2.4 The `categories` cell shows a multi-select dropdown populated with the restaurant's existing categories.
- [ ] 2.2.5 The `tags` cell shows a multi-select dropdown populated with the restaurant's existing tags.
- [ ] 2.2.6 The `is_available` cell is a checkbox, defaulting to checked (true).
- [ ] 2.2.7 The "Save All" button is disabled while any row has validation errors.

#### 2.3 Plan Limit Enforcement

**User Story**: As a free-plan manager, I want to be warned when adding rows would exceed my plan limit so that I know I need to upgrade.

**Acceptance Criteria**:

- [ ] 2.3.1 When the number of rows in the grid would cause the total item count to exceed the plan limit, a warning banner is shown.
- [ ] 2.3.2 The "Add Row" button is disabled when the current row count equals the remaining plan slots.
- [ ] 2.3.3 The "Save All" button is disabled when the batch would exceed the plan limit.

#### 2.4 Batch Save

**User Story**: As a restaurant manager, I want to save all rows at once so that I don't have to click "Add" for each item.

**Acceptance Criteria**:

- [ ] 2.4.1 Clicking "Save All" triggers sequential creation of all rows using `createMenuItem`.
- [ ] 2.4.2 A progress indicator shows save progress (e.g., "Saving 2 / 5…").
- [ ] 2.4.3 For each successfully created item, `setMenuItemCategories` and `setMenuItemTags` are called.
- [ ] 2.4.4 Successfully saved rows are visually marked (green) and become read-only.
- [ ] 2.4.5 Failed rows are visually marked (red) with the error message; they remain editable for retry.
- [ ] 2.4.6 After all rows are processed, `onImportComplete` is called so `MenuManager` reloads the item list.
- [ ] 2.4.7 A "Clear Saved" button removes all successfully saved rows from the grid.

---

### 3. MenuManager Integration

#### 3.1 Tab Navigation

**User Story**: As a restaurant manager, I want the bulk upload options to be accessible from the existing Menu Items screen without navigating away.

**Acceptance Criteria**:

- [ ] 3.1.1 The `MenuManager` component renders three tabs: "Menu Items" (existing), "CSV Upload" (new), and "Bulk Edit" (new).
- [ ] 3.1.2 The existing single-item add/edit dialog continues to work unchanged on the "Menu Items" tab.
- [ ] 3.1.3 The active tab is preserved during the session (not reset on re-render).

#### 3.2 Data Refresh

**User Story**: As a restaurant manager, I want the menu item list to update automatically after a bulk import so that I can see the newly added items immediately.

**Acceptance Criteria**:

- [ ] 3.2.1 After a successful batch save (full or partial), the "Menu Items" tab item list is refreshed.
- [ ] 3.2.2 The item count in the header updates to reflect the newly added items.
- [ ] 3.2.3 The existing Supabase Realtime subscription in `MenuManager` continues to function and will also pick up the new items.

---

## Correctness Properties

### Property 1: Batch completeness
For any non-empty array of `DraftRow[]` passed to `batchCreateMenuItems`, the result satisfies:
```
result.succeeded + result.failed === rows.length
```

### Property 2: CSV round-trip
For any `DraftRow[]` with valid `name` and `price` fields, serialising to CSV via `generateCSVTemplate` and then parsing with `parseCSV` produces a `ParseResult` with zero errors and the same number of rows.

### Property 3: Validation completeness
For any CSV string where at least one data row has a blank `name`, `parseCSV` returns at least one `ParseError` with `field === 'name'`.

### Property 4: Plan limit safety
For any import attempt where `currentItemCount + rows.length > maxItems` (free plan), the "Import" / "Save All" button is disabled and no `createMenuItem` call is made.
