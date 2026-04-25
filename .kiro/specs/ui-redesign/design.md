# UI Redesign Bugfix Design

## Overview

The app has accumulated a layer of "AI-generated" visual noise: gradient backgrounds on buttons and badges, custom keyframe animations (`pop`, `wiggle`, `badge-pop`, `float-up`), hover translate/scale effects, colored drop-shadows, mixed border-radius values, and non-standard avatar patterns. These patterns make every screen feel inconsistent and gimmicky rather than calm and functional.

The fix is surgical: strip the offending CSS and component-level classes, replace them with the design system already in place (shadcn/ui components, CSS variables, `rounded-lg` only), and keep every line of business logic, API call, and real-time subscription completely untouched.

---

## Glossary

- **Bug_Condition (C)**: Any UI element that uses a gradient background, a custom keyframe animation, a hover translate/scale effect, a colored shadow, a non-`rounded-lg` border-radius, an inline SVG icon where a Lucide icon exists, a `window.confirm()` for destructive actions, or a raw colored square as an avatar.
- **Property (P)**: The element renders using only shadcn/ui components, CSS design-token classes, `rounded-lg`, and `tw-animate-css` entrance animations — with no visual regressions to layout, spacing, or functionality.
- **Preservation**: All API calls, hooks, Supabase queries, real-time subscriptions, auth/RLS logic, geofencing, session persistence, navigation structure, and mobile bottom-nav remain byte-for-byte identical.
- **isBugCondition**: A function that returns `true` when a rendered element contains any of the disallowed patterns listed under Bug_Condition.
- **expectedBehavior**: A function that returns `true` when the rendered element passes the Property check above.
- **handleKeyPress**: Not applicable — this is a visual/CSS bug, not a keyboard-event bug.
- **CartDrawer**: `components/CartDrawer.tsx` — the bottom-sheet cart UI on the customer order page.
- **MenuItemCard**: `components/MenuItemCard.tsx` — individual menu item tile on the customer order page.
- **AppHeader**: `components/layout/AppHeader.tsx` — the top bar used in the manager dashboard.
- **AppSidebar**: `components/layout/AppSidebar.tsx` — the left navigation panel in the manager dashboard.
- **KitchenClient**: `app/kitchen/[restaurant_id]/KitchenClient.tsx` — the kitchen kanban board header.
- **WaiterClient**: `app/waiter/[restaurant_id]/WaiterClient.tsx` — the waiter dashboard header.
- **OrderCard**: `components/kitchen/OrderCard.tsx` — individual order card on the kitchen board.
- **WaiterOrderCard**: `components/waiter/WaiterOrderCard.tsx` — individual order card on the waiter board.
- **AdminClient**: `app/admin/AdminClient.tsx` — the admin panel with PIN gate and restaurant list.
- **Analytics**: `components/manager/Analytics.tsx` — the analytics panel in the manager dashboard.
- **TableSessions**: `components/manager/TableSessions.tsx` — the table grid/list in the manager dashboard.
- **OrderLog**: `components/manager/OrderLog.tsx` — the order history table in the manager dashboard.
- **LandingPage**: `app/page.tsx` — the public marketing/landing page.

---

## Bug Details

### Bug Condition

The bug manifests whenever a UI element is rendered with one or more of the following disallowed patterns. The `isBugCondition` function below formalises the check.

**Formal Specification:**
```
FUNCTION isBugCondition(element)
  INPUT: element — a rendered React element or CSS class string
  OUTPUT: boolean

  RETURN (
    containsGradientBackground(element)          // bg-gradient-to-*, from-*, via-*, to-*
    OR containsCustomKeyframeAnimation(element)  // animate-pop, animate-wiggle, animate-badge-pop, animate-float-up
    OR containsHoverTransformEffect(element)     // hover:-translate-y-*, hover:scale-*, hover:shadow-*-300/*
    OR containsColoredShadow(element)            // shadow-orange-*, shadow-primary/10, shadow-emerald-*
    OR containsNonLgRadius(element)              // rounded-xl, rounded-2xl (outside chart/modal exceptions)
    OR containsInlineSvgWhereIconExists(element) // raw <svg> in StatCard when Lucide icon available
    OR containsWindowConfirm(element)            // window.confirm() / confirm()
    OR containsRawSquareAvatar(element)          // bg-primary square div with single letter, not shadcn Avatar
    OR containsShinyTextComponent(element)       // <ShinyText> component
    OR containsPlanBadgeGradient(element)        // .plan-badge-pro linear-gradient
  )
END FUNCTION
```

### Examples

- **CartDrawer gradient strip**: `<div className="h-1 w-full bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400" />` — expected: removed entirely.
- **CartDrawer Place Order button**: `bg-gradient-to-r from-orange-500 to-amber-500 hover:scale-105 hover:shadow-xl hover:shadow-orange-300/40` — expected: `<Button variant="default">`.
- **CartDrawer success icon**: `bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-200 animate-pop` — expected: `bg-primary` circle with `CheckCircle2`, no animation.
- **MenuItemCard selected state**: `ring-2 ring-primary/60 shadow-md shadow-primary/10` — expected: `border-2 border-primary`.
- **MenuItemCard card shape**: `rounded-2xl` — expected: `rounded-lg`.
- **KitchenClient avatar**: `<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">K</div>` — expected: shadcn `<Avatar>` with `<AvatarFallback>`.
- **OrderCard action button**: `bg-gradient-to-r from-amber-500 to-orange-500 hover:scale-[1.02] hover:shadow-lg` — expected: `<Button>` with solid semantic color class.
- **AppHeader**: renders `<CommandPalette>`, `<Bell>`, `<ChevronDown>` — expected: none of these present.
- **AdminClient toggle**: `confirm("Deactivate…?")` — expected: shadcn `<AlertDialog>`.
- **LandingPage hero CTA**: `bg-gradient-to-r from-orange-500 to-amber-500 hover:scale-105` — expected: `<Button variant="default">`.
- **globals.css**: `@keyframes pop/wiggle/badge-pop/float-up` and `.animate-*` classes present — expected: removed.
- **globals.css `.plan-badge-pro`**: `background: linear-gradient(135deg, #FF5A5F, #FF8C42)` — expected: `background-color: hsl(var(--primary))`.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All Supabase API calls (`placeOrder`, `advanceStatus`, `generateBill`, `accept_order_atomic`, etc.) must continue to work identically.
- Real-time subscriptions (`useKitchenOrders`, `useWaiterOrders`, `useRealtimeMenu`) must remain active and functional.
- Order flow: customer scan → menu browse → cart → place order → order status tracking.
- Auth/RLS: `ProtectedRoute`, `useAuth`, role checks, sign-out redirect.
- Geofencing: location check before ordering when enabled.
- Session persistence: `sessionStorage` for customer name/phone/party size.
- Mobile bottom navigation structure on both customer and manager views.
- Sidebar navigation structure and all manager panel tab routing.
- All manager panel functionality: BillDialog, AddOrderModal, CSV export, date filters, real-time order updates.
- Admin toggle API call and optimistic local state update.
- Logo upload to Supabase Storage.

**Scope:**
All inputs that do NOT involve the disallowed visual patterns listed in `isBugCondition` must be completely unaffected. This includes all business logic, data fetching, state management, and routing.

---

## Hypothesized Root Cause

The visual noise was introduced incrementally as features were built, with each new component defaulting to gradient-heavy, animation-heavy patterns common in AI-generated UI code. There is no single root cause — it is a systemic pattern applied across ~12 files.

1. **Gradient-first button/badge styling**: Every CTA and badge was styled with `bg-gradient-to-r` instead of using the `Button` component's `variant="default"` which already uses `bg-primary`.
2. **Custom keyframe animations in globals.css**: `pop`, `wiggle`, `badge-pop`, `float-up` were added to `globals.css` and applied directly to elements instead of using `tw-animate-css` entrance classes.
3. **Hover transform effects**: `hover:-translate-y-*`, `hover:scale-*`, and `hover:shadow-*-300/*` were added to cards and buttons for "delight" but create visual inconsistency and performance jank.
4. **Inconsistent border-radius**: `rounded-xl` and `rounded-2xl` were used alongside `rounded-lg`, breaking the design token (`--radius: 0.625rem` → `rounded-lg`).
5. **Raw square avatars**: Kitchen and waiter headers use a plain `bg-primary` square `div` with a letter instead of the shadcn `Avatar` component.
6. **Non-standard destructive confirmation**: `window.confirm()` in AdminClient instead of shadcn `AlertDialog`.
7. **Redundant AppHeader elements**: CommandPalette, Bell icon, and ChevronDown were added to the manager header without a clear use case, duplicating sidebar navigation.

---

## Correctness Properties

Property 1: Bug Condition — Disallowed Visual Patterns Are Absent

_For any_ rendered element where `isBugCondition(element)` returns `true` in the current (unfixed) code, the fixed version of that component SHALL render the element such that `isBugCondition(element)` returns `false` — using only shadcn/ui components, CSS design-token classes, `rounded-lg`, and permitted `tw-animate-css` entrance animations.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

Property 2: Preservation — Functional Behavior Is Unchanged

_For any_ user interaction or system event where `isBugCondition` does NOT apply (i.e., the interaction is purely functional — API calls, state transitions, navigation, real-time updates), the fixed code SHALL produce exactly the same behavior as the original code, preserving all order flow, auth, real-time, and navigation functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

---

## Fix Implementation

### Implementation Order (most impactful first)

The order below prioritises: (1) global CSS cleanup first so no orphaned classes remain, (2) customer-facing components next since they affect the most users, (3) staff dashboards, (4) manager panels, (5) admin and landing page.

---

### 1. `app/globals.css`

**Changes:**
- Remove `@keyframes pop`, `@keyframes wiggle`, `@keyframes badge-pop`, `@keyframes float-up`.
- Remove `.animate-pop`, `.animate-wiggle`, `.animate-badge-pop`, `.animate-float-up` utility classes.
- Change `.plan-badge-pro` background from `linear-gradient(135deg, #FF5A5F, #FF8C42)` to `background-color: hsl(var(--primary))`.
- Keep `button:active` scale(0.96) — this is intentional press feedback.
- Keep all status badge classes, `.nav-active`, `.card-shadow`, `.elevated-shadow`, scrollbar styling.

---

### 2. `components/CartDrawer.tsx`

**Changes:**
1. **Remove gradient color strip**: Delete `<div className="h-1 w-full bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400" />` entirely.
2. **Success icon**: Replace `bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-200 animate-pop` with `bg-primary`. Remove `animate-pop`.
3. **Error text**: Remove `animate-wiggle` from the error `<p>` tag.
4. **Place Order button**: Replace the raw `<button>` with `<Button variant="default" size="default">`. Remove all gradient, hover-scale, and colored-shadow classes.
5. **Item count badge**: Replace `bg-gradient-to-br from-orange-500 to-amber-500` with `bg-primary`.
6. **Stepper buttons (expanded list)**: Replace `bg-rose-100 text-rose-600 hover:bg-rose-200` / `bg-emerald-100 text-emerald-700 hover:bg-emerald-200` with `<Button size="icon" variant="outline">` (destructive color via `text-destructive` for the minus/trash button).

---

### 3. `components/MenuItemCard.tsx`

**Changes:**
1. **Card hover effects**: Remove `hover:shadow-lg hover:-translate-y-0.5` from the outer `div`.
2. **Selected state**: Replace `ring-2 ring-primary/60 shadow-md shadow-primary/10` with `border-2 border-primary`.
3. **Card border-radius**: Change `rounded-2xl` to `rounded-lg`.
4. **Add button hover**: Remove `hover:shadow-md hover:shadow-primary/30 hover:scale-110` from the add button.
5. **Quantity number animation**: Remove `animate-pop` from the quantity `<span>`. Remove the `popping` state and `setPopping` logic entirely.
6. **Stepper buttons**: Replace `bg-rose-100 text-rose-600 hover:bg-rose-200` with `<Button size="icon" variant="outline" className="text-destructive hover:text-destructive">`. Replace `bg-primary text-primary-foreground hover:bg-primary/85` with `<Button size="icon" variant="default">`.

---

### 4. `app/kitchen/[restaurant_id]/KitchenClient.tsx`

**Changes:**
1. **Avatar badge**: Replace `<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0"><span className="text-white text-xs font-bold">K</span></div>` with shadcn `<Avatar className="h-8 w-8"><AvatarFallback className="text-xs">K</AvatarFallback></Avatar>`.
2. **Loading state**: Replace `<p className="text-sm text-muted-foreground animate-pulse">Loading orders…</p>` with a `<Skeleton>` layout (e.g., three `<Skeleton className="h-48 w-72 rounded-lg" />` side by side).

---

### 5. `app/waiter/[restaurant_id]/WaiterClient.tsx`

**Changes:**
1. **Avatar badge**: Same as KitchenClient — replace raw square with `<Avatar><AvatarFallback>W</AvatarFallback></Avatar>`.
2. **Loading states**: Replace both `animate-pulse` loading `<p>` tags with `<Skeleton>` components.

---

### 6. `components/kitchen/OrderCard.tsx`

**Changes:**
1. **Status stripe**: Replace all `bg-gradient-to-b from-*` stripe classes in `STATUS_CONFIG` with solid semantic colors:
   - `pending_waiter`: `bg-purple-400`
   - `pending`: `bg-amber-400`
   - `confirmed`: `bg-blue-400`
   - `preparing`: `bg-orange-400`
   - `ready`: `bg-emerald-500`
   - `served`: `bg-muted-foreground/30`
2. **Action button classes**: Replace all `bg-gradient-to-r from-* to-* hover:from-* hover:to-* shadow-md shadow-*-200` with solid color classes:
   - `pending` → `bg-amber-500 hover:bg-amber-600 text-white`
   - `confirmed` → `bg-blue-500 hover:bg-blue-600 text-white`
   - `preparing` → `bg-emerald-500 hover:bg-emerald-600 text-white`
3. **Action button hover effects**: Remove `hover:scale-[1.02] hover:shadow-lg` from the action `<button>`.
4. **Action button shape**: Change `rounded-xl` to `rounded-lg`.
5. **Ready state banner**: Replace `bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200` with `bg-muted/50 border border-border`. Change `rounded-xl` to `rounded-lg`.
6. **Card shape**: Change `rounded-xl` to `rounded-lg` on the outer card `div`.
7. **New order ring**: Replace `ring-2 ring-primary/50 shadow-lg shadow-primary/10` with `ring-2 ring-primary/50` (remove colored shadow).

---

### 7. `components/waiter/WaiterOrderCard.tsx`

**Changes:**
1. **Action buttons**: Replace hardcoded `bg-purple-500 hover:bg-purple-600`, `bg-amber-500 hover:bg-amber-600`, `bg-green-500 hover:bg-green-600` with `<Button variant="default">` plus a minimal semantic override only for color differentiation:
   - Accept: `<Button variant="default" className="bg-purple-500 hover:bg-purple-600">` — or use `variant="outline"` with `text-purple-600 border-purple-300` for a lighter touch.
   - Take: `<Button variant="default" className="bg-amber-500 hover:bg-amber-600">`.
   - Serve: `<Button variant="default">` (uses primary color, which is appropriate for the primary action).
2. **Card shape**: Change `rounded-xl` to `rounded-lg` on the outer card `div`.

---

### 8. `components/layout/AppHeader.tsx`

**Changes:**
1. **Remove CommandPalette**: Delete the entire `CommandPalette` component definition and its render call. Remove the `⌘K` keyboard event listener (`useEffect` for `keydown`). Remove `searchOpen` state.
2. **Remove search bar**: Delete the `<button>` that opens the command palette (the `hidden md:flex` search bar with `Search` icon and `⌘K` hint).
3. **Remove Bell icon**: Delete the `<button>` containing `<Bell>` and the notification badge.
4. **Remove ChevronDown**: Remove `ChevronDown` from the profile button. The profile button becomes just `<ProfileAvatar>` + name/role text.
5. **Remove unused imports**: `Search`, `Bell`, `ChevronDown`, `Command`, `LayoutGrid`, `ClipboardList`, `UtensilsCrossed`, `Users`, `Settings`, `BarChart3`, `Layers`, `Table2`, `Store`, `Webhook`, `Tags`, `CreditCard`, `X` (if only used in palette), `useRef` (if only used for search), `SEARCH_ITEMS` constant.
6. **Remove `notificationCount` prop**: No longer needed. Remove from interface and all usages.
7. **Remove `onNavigate` prop**: No longer needed by the header (sidebar handles navigation). Remove from interface.
8. **Keep**: mobile menu toggle, page title + description, `ThemeToggle`, profile avatar + `DropdownMenu` (name + sign out only).
9. **ProfileAvatar**: The `bg-primary` circle with initials is correct — keep as-is.

---

### 9. `components/layout/AppSidebar.tsx`

**Changes:**
1. **Restaurant logo fallback**: Replace `bg-gradient-to-br from-amber-400 to-orange-500` with `bg-muted` (or `bg-primary` if a colored fallback is desired — `bg-muted` is more neutral).
2. **Pro plan card background**: Replace `bg-gradient-to-br from-primary/10 to-orange/10` with `bg-primary/5 border-primary/20`.
3. **Plan card shape**: Change `rounded-xl` to `rounded-lg` on both plan cards.
4. **`.plan-badge-pro`**: Already handled in globals.css — no component change needed beyond ensuring the class is still applied.

---

### 10. `app/admin/AdminClient.tsx`

**Changes:**
1. **Toggle confirmation**: Replace `confirm("…")` with a shadcn `AlertDialog`. Add state: `const [confirmTarget, setConfirmTarget] = useState<Restaurant | null>(null)`. The toggle button sets `confirmTarget`; the `AlertDialog` calls `toggleActive(confirmTarget)` on confirm.
2. **PIN success icon**: The current PIN gate uses `bg-primary text-primary-foreground` on the icon container — this is already correct. No change needed here.
3. **Table shape**: Change `rounded-xl` to `rounded-lg` on the restaurant table wrapper `div`.

---

### 11. `app/page.tsx` (Landing Page)

**Changes:**
1. **Hero CTA button**: Replace the raw `<Link>` styled as `bg-gradient-to-r from-orange-500 to-amber-500 hover:scale-105 hover:shadow-xl hover:shadow-orange-300/40` with `<Button asChild variant="default" size="lg"><Link href="/onboarding">…</Link></Button>`. Remove all gradient, scale, and colored-shadow classes.
2. **Feature card icons**: Replace `bg-gradient-to-br ${color}` with `bg-primary/10 text-primary` (uniform). Remove the `color` field from the `features` array.
3. **Feature card hover**: Remove `hover:shadow-lg hover:-translate-y-1` from feature card `div`.
4. **Feature card shape**: Change `rounded-xl` to `rounded-lg`.
5. **Logo icon**: Replace `bg-gradient-to-br from-orange-500 to-amber-500` with `bg-primary`.
6. **ShinyText**: Replace `<ShinyText text="modern restaurants" …>` with a plain `<span className="text-primary">modern restaurants</span>`. Remove the `ShinyText` import.
7. **Secondary CTA**: Change `rounded-xl` to `rounded-lg`.

---

### 12. `components/manager/Analytics.tsx`

**Changes:**
1. **KpiCard shape**: Change `rounded-2xl` to `rounded-lg`.
2. **KpiCard hover**: Remove `hover:shadow-md` transition.
3. **Revenue chart container**: Change `rounded-2xl` to `rounded-lg`.
4. **Order status donut container**: Change `rounded-2xl` to `rounded-lg`.
5. **Empty state containers**: Change `rounded-xl` to `rounded-lg` on dashed-border empty states.
6. **Hardcoded hex colors in chart segments**: These are used in SVG/canvas contexts where CSS variables cannot be used directly — keep as-is (they are chart data colors, not UI chrome).

---

### 13. `components/manager/TableSessions.tsx`

**Changes:**
1. **StatCard inline SVG icons**: Replace the five inline `<svg>` elements in `StatCard` calls with Lucide icons:
   - Active Tables: `<LayoutGrid className="h-5 w-5 text-blue-500" />`
   - Bill Ready: `<CheckCircle2 className="h-5 w-5 text-green-500" />`
   - Awaiting Attention: `<AlertCircle className="h-5 w-5 text-amber-500" />`
   - Today's Revenue: `<Banknote className="h-5 w-5 text-primary" />` (or `DollarSign`)
   - Avg. Order Value: `<Users className="h-5 w-5 text-purple-500" />`
2. **StatCard shape**: Change `rounded-2xl` (if present) to `rounded-lg`.
3. **AddOrderModal shape**: Change `rounded-2xl` to `rounded-lg` on the modal container.
4. **Menu item rows in AddOrderModal**: Change `rounded-xl` to `rounded-lg`.

---

### 14. `components/manager/OrderLog.tsx`

**Changes:**
1. **Stat card shape**: Change `rounded-xl` to `rounded-lg` on stat card `div`s.
2. **Stat card shadow**: Remove `card-shadow` custom class from stat cards (use standard `border border-border` only, which is already present).
3. **Table container shape**: Change `rounded-xl` to `rounded-lg` on the table wrapper `div`.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, write tests that assert the presence of disallowed patterns on the **unfixed** code (these tests should fail on unfixed code, confirming the bug), then verify the fix removes those patterns while preserving all functional behavior.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause analysis.

**Test Plan**: Write snapshot or DOM-query tests that render each affected component and assert that disallowed class strings are present. Run on unfixed code — tests should fail (i.e., the disallowed classes ARE found, confirming the bug).

**Test Cases:**
1. **CartDrawer gradient strip test**: Render `CartDrawer` with items in cart, assert `bg-gradient-to-r from-orange-400` is present in the DOM (will pass on unfixed code, confirming bug).
2. **CartDrawer Place Order gradient test**: Assert `bg-gradient-to-r from-orange-500 to-amber-500` is present on the Place Order button.
3. **MenuItemCard rounded-2xl test**: Render `MenuItemCard`, assert outer `div` has `rounded-2xl` class.
4. **KitchenClient raw avatar test**: Render `KitchenClient` header, assert a `div` with `bg-primary rounded-lg` containing text "K" is present (not an `Avatar` component).
5. **OrderCard gradient stripe test**: Render `OrderCard` with `status="pending"`, assert `bg-gradient-to-b` is present in the stripe element.
6. **AppHeader CommandPalette test**: Render `AppHeader`, assert a `Search` input or `⌘K` hint is present in the DOM.
7. **AdminClient window.confirm test**: Assert `window.confirm` is called when the toggle button is clicked (spy on `window.confirm`).
8. **globals.css keyframe test**: Assert `@keyframes pop` is present in the CSS file content.

**Expected Counterexamples:**
- All eight tests above should find the disallowed patterns in the unfixed code.
- After the fix, all eight tests should fail to find those patterns (i.e., the assertions are inverted for the fix-checking phase).

---

### Fix Checking

**Goal**: Verify that for all elements where `isBugCondition` holds, the fixed component renders without the disallowed pattern.

**Pseudocode:**
```
FOR ALL component WHERE isBugCondition(component.render()) DO
  result := fixedComponent.render()
  ASSERT NOT containsGradientBackground(result)
  ASSERT NOT containsCustomKeyframeAnimation(result)
  ASSERT NOT containsHoverTransformEffect(result)
  ASSERT NOT containsColoredShadow(result)
  ASSERT NOT containsNonLgRadius(result)
  ASSERT expectedBehavior(result)
END FOR
```

---

### Preservation Checking

**Goal**: Verify that for all functional behaviors where `isBugCondition` does NOT apply, the fixed code produces the same result as the original.

**Pseudocode:**
```
FOR ALL userInteraction WHERE NOT isBugCondition(userInteraction) DO
  ASSERT originalComponent.behavior(userInteraction)
       = fixedComponent.behavior(userInteraction)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of cart items, order states, and user inputs automatically.
- It catches edge cases (empty cart, zero quantity, missing customer info) that manual tests miss.
- It provides strong guarantees that functional behavior is unchanged across the full input domain.

**Test Cases:**
1. **CartDrawer order submission preservation**: Verify that `placeOrder` is called with the correct payload after the Place Order button is replaced with `<Button variant="default">`.
2. **MenuItemCard quantity update preservation**: Verify that `onAddToCart` and `onDecrement` are called correctly after stepper buttons are replaced with shadcn `Button`.
3. **KitchenClient order advance preservation**: Verify that `advanceStatus` is called with the correct `orderId` and `newStatus` after the action button gradient is replaced.
4. **AdminClient toggle preservation**: Verify that `toggleActive` is called with the correct restaurant after `AlertDialog` replaces `window.confirm`.
5. **AppHeader sign-out preservation**: Verify that `onSignOut` is called when the profile dropdown sign-out item is clicked after removing Bell/Search/ChevronDown.

---

### Unit Tests

- Test that `CartDrawer` renders `<Button>` (shadcn) for the Place Order action, not a raw `<button>` with gradient classes.
- Test that `MenuItemCard` outer `div` has `rounded-lg` class, not `rounded-2xl`.
- Test that `KitchenClient` header renders an `Avatar` component, not a raw `bg-primary` square.
- Test that `AppHeader` does not render a `Bell` icon or `Search` input.
- Test that `AdminClient` renders an `AlertDialog` trigger, not a `window.confirm` call.
- Test that `globals.css` does not contain `@keyframes pop` or `@keyframes wiggle`.

### Property-Based Tests

- Generate random `CartItem[]` arrays (varying lengths, quantities, prices) and verify that `CartDrawer` renders without any gradient class in the output for all inputs.
- Generate random `MenuItem` objects (with/without images, tags, descriptions) and verify that `MenuItemCard` renders with `rounded-lg` and without `animate-pop` for all inputs.
- Generate random `KitchenOrder` objects across all statuses and verify that `OrderCard` renders action buttons without gradient classes for all statuses.
- Generate random `OrderStatus` values and verify that `WaiterOrderCard` action buttons use `Button` component (not raw `<button>` with hardcoded color classes) for all statuses.

### Integration Tests

- Full customer flow: scan → browse → add items → place order → success state — verify no gradient or animation classes appear at any step.
- Kitchen flow: order appears → accept → prepare → ready — verify all action buttons use solid colors and no hover-scale effects.
- Manager flow: navigate to Analytics, TableSessions, OrderLog — verify all stat cards use `rounded-lg` and no `card-shadow` custom class on OrderLog.
- Admin flow: toggle restaurant active state — verify `AlertDialog` appears instead of browser `confirm()`.
