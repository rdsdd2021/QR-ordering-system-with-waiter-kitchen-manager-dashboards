# UI Redesign Tasks

## Part 1 — Global CSS & Tokens
- [x] 1. Clean up globals.css: remove custom keyframe animations (pop, wiggle, badge-pop, float-up) and their utility classes; fix .plan-badge-pro gradient to solid bg-primary

## Part 2 — Customer-Facing Components
- [x] 2. Redesign CartDrawer: remove gradient strip, fix Place Order button to shadcn Button, fix success icon, remove animate-pop/wiggle, fix stepper buttons, fix item count badge
- [x] 3. Redesign MenuItemCard: remove hover translate/shadow, fix selected state to border-2 border-primary, change rounded-2xl to rounded-lg, remove animate-pop and popping state, fix stepper buttons to shadcn Button

## Part 3 — Staff Dashboards (Kitchen & Waiter)
- [x] 4. Redesign KitchenClient header: replace raw square avatar with shadcn Avatar, replace animate-pulse loading text with Skeleton components
- [x] 5. Redesign WaiterClient header: same avatar and skeleton fixes as KitchenClient
- [x] 6. Redesign OrderCard: replace gradient stripes with solid colors, replace gradient action buttons with solid Button, remove hover-scale effects, fix rounded-xl to rounded-lg
- [x] 7. Redesign WaiterOrderCard: fix action button colors to use Button component, change rounded-xl to rounded-lg

## Part 4 — Manager Dashboard Layout
- [x] 8. Simplify AppHeader: remove CommandPalette, Bell icon, search bar, ChevronDown; keep only title + ThemeToggle + profile dropdown (name + sign out)
- [x] 9. Fix AppSidebar: replace gradient logo fallback with bg-muted, replace gradient pro plan card with solid bg-primary/5, change rounded-xl to rounded-lg

## Part 5 — Manager Panels
- [x] 10. Fix Analytics panel: change all rounded-2xl/rounded-xl to rounded-lg, remove hover:shadow-md from KpiCard
- [x] 11. Fix TableSessions panel: replace inline SVG icons in StatCards with Lucide icons, change rounded-2xl/rounded-xl to rounded-lg in modal and cards
- [x] 12. Fix OrderLog panel: change rounded-xl to rounded-lg on stat cards and table container, remove card-shadow custom class from stat cards

## Part 6 — Admin & Landing Page
- [x] 13. Fix AdminClient: replace window.confirm() with shadcn AlertDialog for restaurant toggle, change rounded-xl to rounded-lg on table wrapper
- [x] 14. Fix Landing Page: replace gradient hero CTA with Button variant=default, replace gradient feature icons with bg-primary/10, remove hover translate effects, replace ShinyText with plain span, fix rounded-xl to rounded-lg, replace gradient logo with bg-primary
