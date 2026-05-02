# Implementation Plan

- [x] 1. Write bug condition exploration tests (BEFORE implementing any fix)
  - **Property 1: Bug Condition** - Quick Wins: Price Manipulation, Zero Quantity, Inactive Retry, Plan Limit Bypass, Orphaned Order, Name Drift, Yearly Price Undercharge
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each bug exists
  - **Scoped PBT Approach**: For deterministic bugs, scope each property to the concrete failing case(s) to ensure reproducibility
  - QW-2: Submit POST /api/orders with price:0 for a menu item costing ₹150 in DB; assert order item is inserted at ₹0 (isBugCondition_QW2 — client price != DB price)
  - QW-6: Submit POST /api/orders with quantity:0; assert request returns HTTP 400 (will fail — currently returns 200 and inserts the zero-quantity row)
  - QW-9: Call retryDelivery(id) for a delivery whose endpoint has is_active=false; assert no HTTP request is dispatched (will fail — currently dispatches)
  - QW-10: Call createTable() directly when restaurant is at the 5-table trial limit; assert an error is returned (will fail — currently inserts the 6th table)
  - QW-11: Mock the order_items INSERT to fail after the orders INSERT succeeds; assert no orphaned orders row exists (will fail — orphan is left)
  - QW-4: Place an order, rename the menu item, query the historical order; assert order_items shows the original name (will fail — shows new name via JOIN)
  - QW-7: Query plans WHERE id='pro'; assert yearly_paise >= monthly_paise * 9 (will fail — 79900 < 899100)
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: All tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found to understand root causes
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 2.1, 2.2, 6.1, 6.2, 6.3, 9.1, 10.1, 10.2, 11.1, 11.2, 4.1, 4.2, 7.3_

- [x] 2. Write preservation property tests (BEFORE implementing any fix)
  - **Property 2: Preservation** - Quick Wins: Valid Order Flow, Active Retry, Below-Limit Creation, Active Menu Items, Monthly Pricing, Valid Quantities, Valid Webhook Signatures, Grace Period
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs and observe actual outputs before writing assertions
  - Observe: POST /api/orders with correct prices and quantities 1–99 → order created, order id returned (QW-11/QW-6 preservation)
  - Observe: retryDelivery() with is_active=true → HTTP request dispatched, delivery record updated (QW-9 preservation)
  - Observe: createTable() for Pro restaurant below limit → table created successfully (QW-10 preservation)
  - Observe: getMenuItems() / getAllMenuItems() with deleted_at IS NULL items → items returned unchanged (QW-4 preservation)
  - Observe: monthly checkout → charged monthly_paise=99900, unchanged (QW-7 preservation)
  - Observe: verifyWebhookSignature() with valid signature and timestamp within 5 minutes → {valid: true} (QW-5 preservation)
  - Observe: past_due subscription within 3 days of current_period_end → isExpired=false, Pro access granted (QW-7 grace period preservation)
  - Write property-based tests capturing all observed behavior patterns from Preservation Requirements in design
  - Property-based testing generates many test cases for stronger guarantees across the input domain
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: All tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8, 3.11, 3.12, 3.13, 3.15, 3.18, 3.19, 3.20_

- [x] 3. Fix QW-1 — Schedule cron jobs via pg_cron and vercel.json

  - [x] 3.1 Schedule audit-log-purge via pg_cron migration
    - Create a new Supabase migration that runs: SELECT cron.schedule('audit-log-purge', '0 2 * * *', 'SELECT public.purge_expired_audit_logs()')
    - pg_cron v1.6.4 is already installed and active — no extension setup needed
    - This runs entirely inside Postgres with no Vercel plan dependency
    - _Bug_Condition: isBugCondition_QW1(vercel.json) — vercel.json has no "crons" key, purge_expired_audit_logs() never runs_
    - _Expected_Behavior: purge_expired_audit_logs() runs daily at 02:00 UTC via pg_cron_
    - _Preservation: Cron routes called with valid Authorization header continue to execute and return 200 (Requirement 3.9)_
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.2 Add vercel.json cron entries as fallback
    - Update vercel.json from {} to include a "crons" array
    - Add entry: { "path": "/api/cron/audit-log-purge", "schedule": "0 2 * * *" }
    - Add entry: { "path": "/api/cron/webhook-retries", "schedule": "*/5 * * * *" } (adjust to Vercel plan — Hobby allows daily only)
    - The existing route handlers already contain the logic; this just triggers them
    - _Requirements: 1.1, 1.2_

  - [x] 3.3 Verify cron bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Cron Jobs Scheduled
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Verify vercel.json now has a "crons" key (isBugCondition_QW1 returns false)
    - Verify pg_cron job 'audit-log-purge' exists in cron.job table
    - **EXPECTED OUTCOME**: Test PASSES (confirms cron scheduling is in place)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Cron Route Handlers Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm cron routes called with valid Authorization: Bearer $CRON_SECRET still return 200
    - Confirm cron routes called without valid secret still return 401
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.9, 3.10_

- [x] 4. Fix QW-2 + QW-4 + QW-11 — Atomic order creation with server-side prices and name snapshot (combined)

  - [x] 4.1 Create place_order_atomic Postgres RPC migration
    - Create new Supabase migration with SECURITY INVOKER function place_order_atomic(p_restaurant_id UUID, p_table_id UUID, p_items JSONB, p_customer_name TEXT, p_customer_phone TEXT, p_party_size INT)
    - Step (a): call get_initial_order_status(p_restaurant_id) internally to derive 'pending' or 'pending_waiter'
    - Step (b): fetch actual prices from menu_items WHERE id = ANY(item_ids) AND restaurant_id = p_restaurant_id — RAISE EXCEPTION if any item not found or belongs to wrong restaurant
    - Step (c): fetch floor price multiplier from tables → floors
    - Step (d): INSERT orders row with derived status
    - Step (e): INSERT all order_items rows with name snapshot from step (b) and server-side prices from steps (b)–(c)
    - Step (f): RETURN the new order id
    - All steps run in one implicit Postgres transaction — any failure rolls back everything, no orphaned rows
    - Add name TEXT column to order_items (nullable for backward compat with existing rows) in the same migration
    - Deprecate calculate_item_prices_batch() — add a comment marking it as unused but do NOT delete it
    - _Bug_Condition: isBugCondition_QW2 (client price != DB price), isBugCondition_QW4_name (order_items.name IS NULL), isBugCondition_QW11 (step3_failed AND step1_succeeded)_
    - _Expected_Behavior: order_items.price = menu_items.price * floor_multiplier; order_items.name = menu_items.name at insert time; no orphaned rows on any failure_
    - _Preservation: Valid orders with correct item ids and quantities continue to return an order id (Requirement 3.1, 3.11)_
    - _Requirements: 2.3, 2.4, 4.1, 4.2, 11.1, 11.2, 11.3, 11.4_

  - [x] 4.2 Update /api/orders/route.ts to call place_order_atomic
    - Remove the 3-step flow: INSERT orders, RPC calculate_item_prices_batch, INSERT order_items
    - Remove the routing mode fetch (now handled inside the RPC via get_initial_order_status)
    - Replace with single: supabase.rpc('place_order_atomic', { p_restaurant_id, p_table_id, p_items: items.map(i => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })), p_customer_name, p_customer_phone, p_party_size })
    - Keep all pre-checks in the route: rate limiting, party size validation, quantity validation (QW-6 added in task 5), check_table_has_unpaid_orders
    - Note: item.price from the request body is intentionally NOT passed to the RPC — the RPC fetches prices from DB
    - _Requirements: 11.2, 11.3_

  - [x] 4.3 Verify atomic order creation bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Atomic Order Creation with Server-Side Prices and Name Snapshot
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - Re-run QW-2 test: POST /api/orders with price:0 → order_items.price should now equal menu_items.price (not 0)
    - Re-run QW-4 test: place order, rename item, query history → order_items.name shows original name (snapshot)
    - Re-run QW-11 test: simulate step failure → no orphaned orders row, transaction rolled back
    - **EXPECTED OUTCOME**: All three tests PASS (confirms bugs are fixed)
    - _Requirements: 2.3, 2.4, 4.1, 4.2, 11.1, 11.2_

  - [x] 4.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Orders Unaffected by Atomicity Fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm valid orders (correct item ids, quantities 1–99) still return an order id
    - Confirm order_items rows are created with correct prices and quantities
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.11_

- [x] 5. Fix QW-3 — Add health check endpoint

  - [x] 5.1 Create app/api/health/route.ts
    - Create new GET handler at app/api/health/route.ts
    - Attempt a lightweight Supabase query: supabase.from('restaurants').select('id').limit(1)
    - On success: return NextResponse.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() }, { status: 200 })
    - On failure: return NextResponse.json({ status: "error", db: "error", timestamp: new Date().toISOString() }, { status: 503 })
    - _Bug_Condition: isBugCondition_QW3 — routeDoesNotExist("/api/health"), GET /api/health returns 404_
    - _Expected_Behavior: GET /api/health returns 200 with {status:"ok",db:"ok",timestamp} when Supabase reachable; 503 with {status:"error"} when unreachable_
    - _Preservation: No existing routes are affected; this is a new route only_
    - _Requirements: 3.1, 3.2_

- [x] 6. Fix QW-4 — Soft delete for menu items + filter gaps + RLS + index

  - [x] 6.1 Create menu_items soft-delete migration
    - ALTER TABLE menu_items ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL
    - CREATE INDEX menu_items_active_idx ON public.menu_items (restaurant_id, is_available) WHERE deleted_at IS NULL
    - Update "Public can read available menu items" RLS policy: USING (is_available = true AND deleted_at IS NULL)
    - Update "Anyone can read available menu items" RLS policy: USING (is_available = true AND deleted_at IS NULL)
    - Leave "Managers can manage menu items" FOR ALL policy unchanged — managers need unrestricted read access for archived items section
    - Update top_selling_items view to use COALESCE(oi.name, mi.name) AS item_name — prefers snapshot, falls back to current name for pre-fix orders
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10, 4.11_

  - [x] 6.2 Update MenuItem TypeScript type in types/database.ts
    - Add deleted_at: string | null to the MenuItem type
    - Update Database.public.Tables.menu_items.Row to include deleted_at
    - _Requirements: 4.7, 4.9_

  - [x] 6.3 Update lib/api.ts for soft delete and filter gaps
    - getMenuItems(): add .is('deleted_at', null) filter alongside existing is_available=true filter
    - getAllMenuItems(): add .is('deleted_at', null) filter
    - deleteMenuItem(): replace hard DELETE with UPDATE SET deleted_at = now() — keep existing webhook and audit log calls, update event name to 'menu.item_archived'
    - Add getArchivedMenuItems(restaurantId): query WHERE deleted_at IS NOT NULL AND restaurant_id = restaurantId
    - Add restoreMenuItem(itemId): UPDATE SET deleted_at = null
    - _Bug_Condition: isBugCondition_QW4_delete — deleteMenuItem() issues hard DELETE; isBugCondition_QW4 filter gaps — getMenuItems/getAllMenuItems have no deleted_at IS NULL filter_
    - _Expected_Behavior: deleteMenuItem() sets deleted_at=now(), row remains in table; getMenuItems/getAllMenuItems never return archived items_
    - _Preservation: Active items (deleted_at IS NULL) continue to appear on customer ordering page and in MenuManager exactly as before (Requirement 3.13, 3.19)_
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 6.4 Add Archived Items section to MenuManager.tsx
    - Add collapsible "Archived Items" section below the active items table
    - Fetch archived items via getArchivedMenuItems(restaurantId)
    - Add "Restore" button per row that calls restoreMenuItem(itemId) and reloads the item lists
    - _Requirements: 4.6_

  - [x] 6.5 Verify soft-delete bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Soft Delete and Name Snapshot
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - Re-run QW-4 name test: place order, rename item, query history → order_items.name shows original name (covered by task 4.3)
    - Re-run QW-4 delete test: call deleteMenuItem() → deleted_at IS NOT NULL, row still in table, not hard-deleted
    - **EXPECTED OUTCOME**: Tests PASS (confirms soft delete works)
    - _Requirements: 4.3, 4.7_

  - [x] 6.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Active Menu Items Unaffected by Soft Delete
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm getMenuItems() and getAllMenuItems() still return all items with deleted_at IS NULL unchanged
    - Confirm archived items (deleted_at IS NOT NULL) do NOT appear in customer or manager active lists
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.13, 3.19, 3.21_

- [x] 7. Fix QW-5 — Add webhook signature verification utility

  - [x] 7.1 Add verifyWebhookSignature() to lib/webhooks.ts
    - Add function: verifyWebhookSignature(secret: string, body: string, headers: Record<string, string>): Promise<{ valid: boolean; reason?: string }>
    - Check X-Webhook-Timestamp presence; return { valid: false, reason: "Missing timestamp" } if absent
    - Parse timestamp, compute age in seconds; return { valid: false, reason: "Timestamp too old or too far in future" } if |age| > 300
    - Compute expected HMAC-SHA256 signature using signPayload(secret, body, timestamp)
    - Compare to X-Webhook-Signature header (strip "sha256=" prefix); return { valid: false, reason: "Invalid signature" } on mismatch
    - Return { valid: true } on success
    - Export the function so webhook consumers can import it
    - _Bug_Condition: isBugCondition_QW5 — |now() - X-Webhook-Timestamp| > 300s AND noTimestampValidationPerformed()_
    - _Expected_Behavior: verifyWebhookSignature() returns {valid:false, reason:"Timestamp too old..."} for requests older than 5 minutes_
    - _Preservation: Fresh requests with valid signature and recent timestamp continue to return {valid:true} (Requirement 3.12)_
    - _Requirements: 5.1_

  - [x] 7.2 Verify webhook timestamp bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Webhook Timestamp Replay Protection
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Call verifyWebhookSignature() with a timestamp > 5 minutes old → assert {valid: false}
    - **EXPECTED OUTCOME**: Test PASSES (confirms replay protection works)
    - _Requirements: 5.1_

  - [x] 7.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Webhook Signatures Accepted
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm verifyWebhookSignature() with valid signature and timestamp within 5 minutes returns {valid: true}
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.12_

- [x] 8. Fix QW-6 — Add server-side quantity validation

  - [x] 8.1 Add quantity validation to /api/orders/route.ts
    - After the existing items array presence check, add a loop over all items
    - For each item: if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) return NextResponse.json({ error: "Each item quantity must be an integer between 1 and 99" }, { status: 400 })
    - This check runs BEFORE calling place_order_atomic — no rows are inserted on validation failure
    - _Bug_Condition: isBugCondition_QW6(item) — NOT isInteger(quantity) OR quantity < 1 OR quantity > 99_
    - _Expected_Behavior: POST /api/orders returns HTTP 400 with descriptive message; no rows inserted in orders or order_items_
    - _Preservation: Valid quantities (integers 1–99) pass through unchanged, order created normally (Requirement 3.1)_
    - _Requirements: 6.1_

  - [x] 8.2 Verify quantity validation bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Quantity Validation Rejects Invalid Items
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Re-run QW-6 test: POST /api/orders with quantity:0 → assert HTTP 400
    - Also verify quantity:-1, quantity:1.5, quantity:100 all return 400
    - **EXPECTED OUTCOME**: Tests PASS (confirms validation is enforced)
    - _Requirements: 6.1_

  - [x] 8.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Quantities Pass Through Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm POST /api/orders with quantity:1, quantity:50, quantity:99 all create orders normally
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1_

- [x] 9. Fix QW-7 — Yearly price correction, renewal reminders, grace period, and billing labels

  - [x] 9.1 Create yearly price and reminder_sent_at migration
    - UPDATE plans SET yearly_paise = 958800 WHERE id = 'pro' (₹799/mo × 12 = ₹9,588 full annual charge)
    - UPDATE plans SET yearly_paise = 1918800 WHERE id = 'business' (₹1,599/mo × 12 = ₹19,188)
    - ALTER TABLE subscriptions ADD COLUMN reminder_sent_at JSONB DEFAULT '{}'
    - Existing subscription rows get reminder_sent_at = '{}' by default — no existing functionality affected
    - _Bug_Condition: isBugCondition_QW7_yearlyPrice — yearly_paise < monthly_paise * 9 (79900 < 899100)_
    - _Expected_Behavior: yearly_paise >= monthly_paise * 9; Pro: 958800 >= 899100; Business: 1918800 >= 1439100_
    - _Preservation: monthly_paise unchanged at 99900 for Pro; existing yearly subscribers not retroactively charged (Requirement 3.15, 3.16)_
    - _Requirements: 7.2, 7.3_

  - [x] 9.2 Fix isExpired grace period in hooks/useSubscription.ts
    - Update isExpired derivation: past_due only triggers expiry after 3-day grace period
    - New logic: subscription?.status === "past_due" && Date.now() > new Date(subscription.current_period_end).getTime() + 3 * 24 * 60 * 60 * 1000
    - canceled status remains immediately expired — no grace period for deliberate cancellations
    - Change Plan type from "free" | "pro" to "trialing" | "pro"
    - Rename FREE_LIMITS constant to TRIAL_LIMITS
    - Update fallback: { plan: "trialing", status: "active", ... } instead of { plan: "free", ... }
    - _Bug_Condition: isBugCondition_QW7_gracePeriod — status="past_due" AND now() <= current_period_end + 3 days AND isExpiredFlagSet=true_
    - _Expected_Behavior: isExpired returns false during grace window; paywall only activates after current_period_end + 3 days_
    - _Preservation: canceled subscriptions remain immediately expired; active Pro subscriptions unaffected (Requirement 3.18)_
    - _Requirements: 7.9_

  - [x] 9.3 Fix BillingPanel.tsx labels and savings formula
    - Fix savings badge formula: Math.round((1 - (proYearlyPaise / 12) / proMonthlyPaise) * 100) — divide yearly_paise by 12 first to get per-month equivalent
    - Fix yearly CTA label: show full annual amount e.g. "Upgrade — ₹9,588/yr" instead of "₹799/mo"
    - Fix Current Plan price for trialing users: show "Trial" instead of "Free"
    - Add dismissible expiry warning banner: show when isPro && !isExpired && daysUntilExpiry <= 7, with link to Billing tab
    - _Bug_Condition: isBugCondition_QW7 — savings formula produces large negative after price fix; "Free" label shown for trialing users; /mo implies recurring billing_
    - _Expected_Behavior: savings badge shows ~20%; CTA shows full annual amount; trialing users see "Trial"; banner shown within 7 days of expiry_
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.7_

  - [x] 9.4 Add expiry warning banner to ManagerClient.tsx
    - Compute daysUntilExpiry from subscription.current_period_end
    - Render dismissible banner above tab content when isPro && !isExpired && daysUntilExpiry <= 7
    - Banner links directly to the Billing tab
    - _Requirements: 7.1, 7.5_

  - [x] 9.5 Create subscription-reminders Supabase Edge Function
    - Query subscriptions WHERE status = 'active' AND current_period_end <= now() + INTERVAL '7 days'
    - For each row, check reminder_sent_at JSONB for '7d', '3d', '0d' keys to prevent duplicate sends
    - Send in-app notification (Realtime broadcast or notifications table insert)
    - Update reminder_sent_at = jsonb_set(reminder_sent_at, '{7d}', to_jsonb(now())) etc.
    - Reset reminder_sent_at to '{}' when subscription renews
    - Schedule daily at 09:00 IST via Supabase dashboard or pg_cron (if pg_net is enabled)
    - _Requirements: 7.8_

  - [x] 9.6 Verify yearly price bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Yearly Price Corrected
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Re-run QW-7 test: query plans WHERE id='pro' → assert yearly_paise >= monthly_paise * 9 (958800 >= 899100)
    - **EXPECTED OUTCOME**: Test PASSES (confirms yearly price is corrected)
    - _Requirements: 7.2, 7.3_

  - [x] 9.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Monthly Pricing and Grace Period Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm monthly checkout still charges monthly_paise=99900 unchanged
    - Confirm past_due subscription within 3 days of current_period_end still has isExpired=false
    - Confirm canceled subscription still has isExpired=true immediately
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.15, 3.16, 3.18_

- [x] 10. Fix QW-8 — Add React error boundaries to manager dashboard

  - [x] 10.1 Create components/ErrorBoundary.tsx
    - Create React class component ErrorBoundary with getDerivedStateFromError and componentDidCatch
    - Render children normally when no error
    - Render section-level fallback UI with "Something went wrong" message and a "Try again" button that resets state (sets hasError back to false)
    - _Bug_Condition: isBugCondition_QW8 — component throwsRenderError() AND NOT wrappedInErrorBoundary(component)_
    - _Expected_Behavior: rendering error in one section is caught by its ErrorBoundary; section-level fallback shown; all other tabs remain functional_
    - _Preservation: Components that render normally continue to render without any visible error boundary overhead (Requirement 3.6)_
    - _Requirements: 8.1, 8.2_

  - [x] 10.2 Wrap all 12 tab components in ManagerClient.tsx with ErrorBoundary
    - Import ErrorBoundary in app/manager/[restaurant_id]/ManagerClient.tsx
    - Wrap each of the following individually in <ErrorBoundary>: TableSessions, OrderLog, Analytics, MenuManager, TablesManager, FloorsManager, StaffManager, WebhooksManager, BillingPanel, SettingsPanel, RestaurantDetails, CategoryTagManager
    - Each component gets its own independent ErrorBoundary so a failure in one does not affect others
    - _Requirements: 8.2_

  - [x] 10.3 Verify error boundary bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Error Boundaries Catch Section Errors
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Inject a render error into Analytics tab → assert ErrorBoundary fallback shown for Analytics only
    - Assert all other 11 tabs continue to render normally
    - **EXPECTED OUTCOME**: Test PASSES (confirms error boundaries are working)
    - _Requirements: 8.1, 8.2_

  - [x] 10.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Normal Rendering Unaffected
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm all 12 tab components render normally when no errors occur
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.6_

- [x] 11. Fix QW-9 — Skip retry for inactive webhook endpoints

  - [x] 11.1 Add is_active guard to retryDelivery() in lib/webhooks.ts
    - In retryDelivery(), after fetching the endpoint record (ep), add guard before calling dispatchToUrl()
    - If !ep.is_active: update webhook_deliveries SET status='dead', error_message='Endpoint is inactive' WHERE id=deliveryId; return { ok: false, error: "Endpoint is inactive" }
    - Return early without calling dispatchToUrl()
    - _Bug_Condition: isBugCondition_QW9(delivery) — delivery.endpoint.is_active = false_
    - _Expected_Behavior: delivery marked 'dead'; no HTTP request dispatched; early return_
    - _Preservation: is_active=true endpoints continue to have HTTP request dispatched and delivery record updated (Requirement 3.2, 3.3)_
    - _Requirements: 9.1_

  - [x] 11.2 Verify inactive endpoint bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Inactive Endpoints Not Retried
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Re-run QW-9 test: call retryDelivery() with is_active=false → assert delivery.status='dead', no HTTP dispatch
    - **EXPECTED OUTCOME**: Test PASSES (confirms inactive endpoints are skipped)
    - _Requirements: 9.1_

  - [x] 11.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Active Endpoint Retry Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm retryDelivery() with is_active=true still dispatches HTTP request and updates delivery record
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.2, 3.3_

- [x] 12. Fix QW-10 — Server-side plan limit checks + rename "free" to "trialing"

  - [x] 12.1 Create subscriptions schema migration (free → trialing)
    - DROP and recreate subscriptions_plan_check constraint: CHECK (plan IN ('trialing', 'pro'))
    - ALTER TABLE subscriptions ALTER COLUMN plan SET DEFAULT 'trialing'
    - UPDATE subscriptions SET plan = 'trialing' WHERE plan = 'free' (migrates 2 abandoned checkout rows)
    - Update get_plan_limits() Postgres function: rename WHEN 'free' branch to WHEN 'trialing'
    - Update get_restaurant_plan() Postgres function: change COALESCE(s.plan, 'free') to COALESCE(s.plan, 'trialing') and final RETURN COALESCE(v_plan, 'free') to RETURN COALESCE(v_plan, 'trialing')
    - Note: Pro restaurants have plan='pro' and are completely unaffected by this migration
    - _Bug_Condition: isBugCondition_QW10_misnomer — plan value or UI label contains 'free' or 'Free plan'_
    - _Expected_Behavior: all plan values use 'trialing' not 'free'; get_plan_limits('trialing') returns {max_tables:5, max_menu_items:20}_
    - _Preservation: Pro subscriptions (plan='pro') unchanged; isPro derivation (plan==="pro") continues to work (Requirement 3.17)_
    - _Requirements: 10.3, 10.4, 10.6, 10.7, 10.11_

  - [x] 12.2 Add server-side plan limit checks to lib/api.ts
    - createTable(): before INSERT, call supabase.rpc('get_restaurant_plan', { p_restaurant_id }) then supabase.rpc('get_plan_limits', { p_plan }); count current tables with supabase.from('tables').select('id', { count: 'exact' }).eq('restaurant_id', restaurantId); if count >= max_tables return null with error log
    - createMenuItem(): same pattern using max_menu_items limit
    - Use >= (not >) for the limit check — a trial restaurant starts at exactly 5 tables after onboarding, so the first createTable() call is correctly blocked
    - Note: there is no /api/tables or /api/menu-items route — enforcement must be in lib/api.ts
    - _Bug_Condition: isBugCondition_QW10_tables — currentTableCount >= get_plan_limits(get_restaurant_plan(restaurantId)).max_tables_
    - _Expected_Behavior: createTable()/createMenuItem() return error when at or above limit; no DB insert performed_
    - _Preservation: Pro restaurant below limit continues to create tables/items successfully (Requirement 3.7, 3.8, 3.20)_
    - _Requirements: 10.1, 10.2_

  - [x] 12.3 Update /api/phonepe/checkout/route.ts
    - Replace plan = 'free', status = 'incomplete' with plan = 'trialing', status = 'incomplete'
    - _Requirements: 10.4_

  - [x] 12.4 Update UI strings in TablesManager.tsx, MenuManager.tsx, AppSidebar.tsx
    - Replace all "Free plan" strings with "Trial" / "Trial limit" / "Your trial is limited to X tables/items"
    - Replace "Free plan limit reached" with "Trial limit reached"
    - Verify AppSidebar.tsx string-matching logic still works: updated label strings must still contain "pro" or "trial" as substrings so isPro/isTrial derivation from planLabel continues to work correctly
    - _Requirements: 10.7, 10.8, 10.9_

  - [x] 12.5 Update TypeScript types in hooks/useSubscription.ts (if not already done in task 9.2)
    - Ensure Plan type is "trialing" | "pro" (not "free" | "pro")
    - Ensure TRIAL_LIMITS constant name is used (not FREE_LIMITS)
    - Ensure fallback uses { plan: "trialing", ... }
    - _Requirements: 10.5, 10.10_

  - [x] 12.6 Verify plan limit bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Plan Limits Enforced Server-Side
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Re-run QW-10 test: call createTable() directly when restaurant is at 5-table trial limit → assert error returned, table count unchanged
    - Also verify get_plan_limits('trialing') returns {max_tables:5, max_menu_items:20}
    - Also verify no subscription rows have plan='free'
    - **EXPECTED OUTCOME**: Tests PASS (confirms server-side enforcement and schema migration)
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

  - [x] 12.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Pro Plan and Below-Limit Creation Unaffected
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm Pro restaurant below limit can still create tables and menu items
    - Confirm trial restaurant below limit (e.g. 3 tables) can still create tables
    - Confirm Pro subscription rows (plan='pro') are unchanged after migration
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.7, 3.8, 3.17, 3.20_

- [x] 13. Fix QW-12 — Add error monitoring with Sentry

  - [x] 13.1 Install and configure @sentry/nextjs
    - Install @sentry/nextjs with a pinned version (check latest stable at time of implementation)
    - Run npx @sentry/wizard@latest -i nextjs or manually create: sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts
    - Add SENTRY_DSN to .env.local and Vercel environment variables
    - Configure withSentryConfig in next.config.js
    - Add restaurant and user context to Sentry scope in API routes where available
    - _Bug_Condition: isBugCondition_QW12 — unhandled exception NOT reportedToExternalMonitoring_
    - _Expected_Behavior: Sentry captures unhandled exceptions with route, user, and restaurant context_
    - _Preservation: No existing error handling paths are removed; Sentry is additive_
    - _Requirements: 12.1_

- [x] 14. Checkpoint — Ensure all tests pass
  - Re-run the full test suite (unit tests, property-based tests, integration tests)
  - Verify all 7 bug condition exploration tests from task 1 now PASS (confirming all bugs are fixed)
  - Verify all 8 preservation property tests from task 2 still PASS (confirming no regressions)
  - Verify TypeScript compiles without errors (npm run build or tsc --noEmit)
  - Verify no orphaned 'free' plan values remain in the database
  - Verify vercel.json has the crons array
  - Verify pg_cron job 'audit-log-purge' exists in cron.job
  - Verify place_order_atomic RPC exists in Supabase
  - Verify GET /api/health returns 200
  - Ask the user if any questions arise before marking complete
