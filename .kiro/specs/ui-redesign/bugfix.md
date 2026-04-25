# Bugfix Requirements Document

## Introduction

The app's UI/UX has accumulated over-engineered, "AI-generated" visual patterns — gradient buttons, decorative color strips, animated pop effects, heavy shadow stacking, and excessive visual noise — that make the interface feel like a hurdle rather than a tool. This affects all five user roles: customer (order page), kitchen staff, waiter, manager, and admin. The fix is to strip these patterns and replace them with simple, classic shadcn/ui components with subtle, purposeful animations (animate-ui style), making every screen feel calm, fast, and functional.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a customer views the order page THEN the system renders a CartDrawer with a gradient color strip, gradient "Place order" button, and `animate-pop` / `animate-wiggle` keyframe animations that feel gimmicky and inconsistent with a utility-first UI.

1.2 WHEN a customer views menu items THEN the system renders MenuItemCard with `hover:-translate-y-0.5`, `hover:shadow-lg`, `ring-2 ring-primary/60 shadow-md shadow-primary/10`, and gradient-colored stepper buttons that add visual clutter without aiding usability.

1.3 WHEN kitchen or waiter staff view their dashboards THEN the system renders headers with a colored square avatar badge (`bg-primary` box with a single letter) and inline `animate-pulse` loading text instead of standard skeleton or spinner components.

1.4 WHEN a manager views the dashboard THEN the system renders the AppHeader with a command palette, notification bell, and profile dropdown that duplicate navigation already present in the sidebar, adding cognitive overhead without value.

1.5 WHEN any staff user views the AppHeader THEN the system renders a search bar with `⌘K` shortcut, a `Bell` icon with badge, and a `ChevronDown` profile dropdown — all of which are non-functional or redundant for a restaurant operations tool.

1.6 WHEN a visitor views the landing page THEN the system renders hero CTAs as `bg-gradient-to-r from-orange-500 to-amber-500` buttons with `hover:scale-105 hover:shadow-xl hover:shadow-orange-300/40` that look like generic SaaS templates rather than a focused product.

1.7 WHEN a manager views the Analytics, TableSessions, or OrderLog panels THEN the system renders stat cards and tables with inconsistent spacing, mixed border-radius values (`rounded-xl`, `rounded-2xl`, `rounded-lg`), and ad-hoc color classes that are not part of the design token system.

1.8 WHEN the admin views the restaurant list THEN the system renders a PIN gate with a `bg-gradient-to-br from-emerald-400 to-teal-500` success icon and inline `confirm()` dialogs for destructive actions instead of proper modal dialogs.

### Expected Behavior (Correct)

2.1 WHEN a customer views the order page THEN the system SHALL render the CartDrawer using standard shadcn/ui `Button`, `Separator`, and `Sheet` (or bottom-sheet pattern) components with no gradient strips, no custom keyframe animations, and a single solid primary-color CTA.

2.2 WHEN a customer views menu items THEN the system SHALL render MenuItemCard as a flat `Card` with a single `border` state change on selection (e.g. `border-primary`), standard `Button` size="icon" steppers, and no translate/shadow hover effects beyond what shadcn/ui provides by default.

2.3 WHEN kitchen or waiter staff view their dashboards THEN the system SHALL render headers using the shared `AppHeader` component (or a simplified equivalent) with a text avatar via shadcn/ui `Avatar`, and loading states using shadcn/ui `Skeleton` components.

2.4 WHEN a manager views the dashboard THEN the system SHALL render the AppHeader without the command palette and notification bell; navigation SHALL be handled exclusively by the sidebar, keeping the header to: page title, profile avatar, and sign-out.

2.5 WHEN any staff user views the AppHeader THEN the system SHALL render only the page title, an optional description, and a profile menu (name + sign out) using shadcn/ui `DropdownMenu` — no search bar, no bell icon.

2.6 WHEN a visitor views the landing page THEN the system SHALL render hero CTAs as standard shadcn/ui `Button` (default and outline variants) with no gradient backgrounds, no scale transforms, and no colored shadow effects.

2.7 WHEN a manager views any panel THEN the system SHALL render all cards, tables, and stat blocks using a consistent set of shadcn/ui `Card`, `Table`, and `Badge` components with uniform spacing (`p-4`, `gap-4`) and border-radius from the design token (`rounded-lg` only).

2.8 WHEN the admin views the restaurant list THEN the system SHALL render destructive toggle actions using a shadcn/ui `AlertDialog` for confirmation instead of `window.confirm()`, and the PIN gate success state SHALL use a standard `CheckCircle2` icon without gradient backgrounds.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a customer adds items and places an order THEN the system SHALL CONTINUE TO submit the order, show a success state, and transition to the orders tab without functional regression.

3.2 WHEN kitchen staff advance an order status THEN the system SHALL CONTINUE TO update the order in real-time across all connected clients via Supabase Realtime.

3.3 WHEN a waiter takes or serves an order THEN the system SHALL CONTINUE TO assign the waiter_id and update order status correctly.

3.4 WHEN a manager navigates between dashboard tabs THEN the system SHALL CONTINUE TO render the correct panel (TableSessions, OrderLog, Analytics, MenuManager, etc.) without state loss.

3.5 WHEN a manager uploads a restaurant logo THEN the system SHALL CONTINUE TO upload to Supabase Storage and reload the page to reflect the new logo.

3.6 WHEN geofencing is enabled and a customer is outside the radius THEN the system SHALL CONTINUE TO block ordering and display the location error message.

3.7 WHEN a customer's session is saved (name, phone, party size) THEN the system SHALL CONTINUE TO pre-fill the info form on subsequent orders at the same table.

3.8 WHEN the admin toggles a restaurant's active state THEN the system SHALL CONTINUE TO call the toggle API and update the local list optimistically.

3.9 WHEN a staff user signs out THEN the system SHALL CONTINUE TO clear the session and redirect to the login page.

3.10 WHEN the app is viewed on mobile THEN the system SHALL CONTINUE TO render a functional bottom navigation bar for both the customer order page and the manager dashboard.
