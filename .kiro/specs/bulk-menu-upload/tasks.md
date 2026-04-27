# Tasks: Bulk Menu Upload

## Task List

- [x] 1. Add `DraftRow` type and install `papaparse`
  - [x] 1.1 Add `DraftRow` interface to `qr-order/types/database.ts`
  - [x] 1.2 Install `papaparse` and `@types/papaparse` in `qr-order/`

- [x] 2. Create `csvParser.ts` utility
  - [x] 2.1 Create `qr-order/lib/csvParser.ts` with `generateCSVTemplate`, `parseCSV`, and `buildNameMap` functions
  - [x] 2.2 Write unit tests for `parseCSV` (valid CSV, missing name, invalid price, comment rows, blank lines, unknown categories)
  - [x] 2.3 Write unit tests for `generateCSVTemplate` (header row, comment rows, empty categories/tags)

- [x] 3. Create `batchCreateMenuItems.ts` utility
  - [x] 3.1 Create `qr-order/lib/batchCreateMenuItems.ts` implementing the sequential batch create algorithm
  - [x] 3.2 Write unit tests with mocked `createMenuItem` (all succeed, partial failure, all fail)

- [x] 4. Create `CSVUploadTab` component
  - [x] 4.1 Create `qr-order/components/manager/bulk-upload/CSVUploadTab.tsx`
  - [x] 4.2 Implement "Download Template" button using `generateCSVTemplate` and Blob download
  - [x] 4.3 Implement file input with `.csv` accept filter and parse-on-select behaviour
  - [x] 4.4 Render preview table with per-cell error highlighting
  - [x] 4.5 Implement row delete from preview
  - [x] 4.6 Implement plan limit warning banner and button disable logic
  - [x] 4.7 Implement "Import N Items" button with progress indicator calling `batchCreateMenuItems`
  - [x] 4.8 Show post-import summary (success count, error list) and call `onImportComplete`

- [x] 5. Create `BulkEditTab` component
  - [x] 5.1 Create `qr-order/components/manager/bulk-upload/BulkEditTab.tsx`
  - [x] 5.2 Implement editable grid with Add Row / delete row controls
  - [x] 5.3 Implement inline cell validation (name required, price positive number)
  - [x] 5.4 Implement category multi-select dropdown per row
  - [x] 5.5 Implement tag multi-select dropdown per row
  - [x] 5.6 Implement plan limit warning and Add Row / Save All disable logic
  - [x] 5.7 Implement "Save All (N items)" button with progress indicator calling `batchCreateMenuItems`
  - [x] 5.8 Mark saved rows green (read-only) and failed rows red; implement "Clear Saved" button
  - [x] 5.9 Call `onImportComplete` after batch save completes

- [ ] 6. Integrate into `MenuManager`
  - [x] 6.1 Wrap the existing `MenuManager` content in a `<Tabs>` component with "Menu Items", "CSV Upload", and "Bulk Edit" tabs
  - [x] 6.2 Pass `categories`, `tags`, `isPro`, `items.length`, and `limits.max_menu_items` as props to `BulkMenuUpload` (or directly to each tab)
  - [x] 6.3 Wire `onImportComplete` to call `loadItems()` in `MenuManager`
  - [x] 6.4 Verify existing single-item add/edit dialog still works on the "Menu Items" tab

- [ ] 7. End-to-end verification
  - [ ] 7.1 Manually test CSV download → fill → upload → import flow in the browser
  - [ ] 7.2 Manually test inline grid add rows → fill → save flow in the browser
  - [ ] 7.3 Verify plan limit enforcement for free-plan accounts
  - [ ] 7.4 Verify partial failure handling (mock a failing row)
  - [ ] 7.5 Verify Realtime subscription still fires after bulk import
