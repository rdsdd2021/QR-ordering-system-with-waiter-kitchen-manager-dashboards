# Animated UI Components

This project now includes animated UI components inspired by [Animate UI](https://animate-ui.com), built with Motion (Framer Motion) and Radix UI primitives.

## 🎨 Available Animated Components

> **Live Demo**: See all components in action at `components/examples/AnimatedComponentsShowcase.tsx`

### 1. **Checkbox** (`components/ui/checkbox.tsx`)
Animated checkbox with spring-based check mark animation.

**Features:**
- Smooth scale and opacity animation on check/uncheck
- Spring physics for natural feel
- Variants: `default`, `accent`
- Sizes: `sm`, `default`, `lg`

**Usage:**
```tsx
import { Checkbox } from "@/components/ui/checkbox";

<Checkbox 
  checked={isChecked}
  onCheckedChange={setIsChecked}
  variant="default"
  size="default"
/>
```

**Props:**
- `variant`: "default" | "accent"
- `size`: "sm" | "default" | "lg"
- All standard Radix UI Checkbox props

---

### 2. **Switch** (`components/ui/switch.tsx`)
Animated toggle switch with smooth thumb transition.

**Features:**
- Spring-based layout animation
- Smooth thumb sliding
- Sizes: `sm`, `default`

**Usage:**
```tsx
import { Switch } from "@/components/ui/switch";

<Switch 
  checked={isEnabled}
  onCheckedChange={setIsEnabled}
  size="default"
/>
```

---

### 3. **AnimatedBadge** (`components/ui/animated-badge.tsx`)
Badge component with entrance animation and hover effects.

**Features:**
- Scale and opacity entrance animation
- Hover scale effect
- All standard badge variants

**Usage:**
```tsx
import { AnimatedBadge } from "@/components/ui/animated-badge";

<AnimatedBadge variant="success">
  Active
</AnimatedBadge>

// Disable animation if needed
<AnimatedBadge variant="default" animate={false}>
  Static Badge
</AnimatedBadge>
```

---

### 4. **AnimatedInput** (`components/ui/animated-input.tsx`)
Animated input field with focus effects and visual feedback.

**Features:**
- Subtle scale animation on focus
- Animated focus indicator border
- Error state styling
- Spring-based transitions

**Usage:**
```tsx
import { AnimatedInput } from "@/components/ui/animated-input";

<AnimatedInput 
  placeholder="Enter text"
  error={hasError}
/>
```

**Props:**
- `error`: boolean - Shows error styling with red border and ring
- All standard HTML input props

---

### 5. **AnimatedCard** (`components/ui/animated-card.tsx`)
Card component with entrance animation and interactive hover/tap effects.

**Features:**
- Fade-in and slide-up entrance
- Hover scale effect
- Tap scale feedback
- Customizable scale values

**Usage:**
```tsx
import { 
  AnimatedCard, 
  AnimatedCardHeader, 
  AnimatedCardTitle,
  AnimatedCardDescription,
  AnimatedCardContent,
  AnimatedCardFooter
} from "@/components/ui/animated-card";

<AnimatedCard hoverScale={1.03} tapScale={0.97}>
  <AnimatedCardHeader>
    <AnimatedCardTitle>Card Title</AnimatedCardTitle>
    <AnimatedCardDescription>Card description</AnimatedCardDescription>
  </AnimatedCardHeader>
  <AnimatedCardContent>
    Content goes here
  </AnimatedCardContent>
  <AnimatedCardFooter>
    Footer content
  </AnimatedCardFooter>
</AnimatedCard>
```

---

## 🔄 Updated Components

The following components have been updated to use animated versions:

### Files Updated:
1. **`components/admin/CouponManager.tsx`**
   - Checkbox for "Active" toggle

2. **`components/admin/PlanManager.tsx`**
   - Checkboxes for "Highlighted" and "Active" toggles

3. **`components/manager/bulk-upload/BulkEditTab.tsx`**
   - Checkbox for "Available" status in bulk edit table

---

## 🎯 Animation Principles

All animations follow these principles:

1. **Spring Physics**: Natural, bouncy feel using spring animations
2. **Performance**: GPU-accelerated transforms (scale, opacity)
3. **Accessibility**: Respects `prefers-reduced-motion`
4. **Subtle**: Enhances UX without being distracting
5. **Consistent**: Same timing and easing across components

---

## 🛠️ Customization

### Animation Parameters

You can customize animations by modifying the Motion props:

```tsx
// Example: Slower, bouncier checkbox
<motion.div
  initial={{ scale: 0, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  transition={{
    type: "spring",
    stiffness: 300,  // Lower = slower
    damping: 20,     // Lower = more bounce
    mass: 1
  }}
>
```

### Common Spring Values:
- **Snappy**: `stiffness: 700, damping: 30`
- **Smooth**: `stiffness: 300, damping: 25`
- **Bouncy**: `stiffness: 500, damping: 15`

---

## 📦 Dependencies

The animated components use:
- `motion` (v12.38.0) - Animation library
- `@radix-ui/react-checkbox` - Checkbox primitive
- `radix-ui` - Switch and other primitives
- `class-variance-authority` - Variant management
- `tailwind-merge` - Class merging

---

## 🚀 Adding More Animated Components

To add more animated components from Animate UI:

1. Visit [animate-ui.com](https://animate-ui.com)
2. Browse the component library
3. Copy the component code
4. Adapt it to your project's design system
5. Add it to `components/ui/`

### Recommended Components to Add:
- **Select** - Animated dropdown
- **Dialog** - Modal with entrance animation
- **Tooltip** - Smooth tooltip appearance
- **Accordion** - Expandable sections
- **Tabs** - Animated tab switching

---

## 🎨 Design System Integration

All animated components:
- Use your existing Tailwind theme
- Support dark mode
- Follow shadcn/ui conventions
- Are fully typed with TypeScript
- Support all Radix UI accessibility features

---

## 📝 Notes

- Animations are disabled when `prefers-reduced-motion` is set
- All components are client-side only (`"use client"`)
- Components maintain full keyboard navigation support
- Screen readers are not affected by animations

---

## 🎨 Live Showcase

A complete interactive showcase is available at:
- **Route**: `/demo` - Visit this page in your browser to see all animations
- **File**: `components/examples/AnimatedComponentsShowcase.tsx`
- **Features**: Interactive examples, code snippets, and usage patterns

To view the showcase:
1. Start your development server
2. Navigate to `http://localhost:3000/demo`
3. Interact with all animated components

You can also import the showcase component in any page:
```tsx
import AnimatedComponentsShowcase from "@/components/examples/AnimatedComponentsShowcase";

export default function ShowcasePage() {
  return <AnimatedComponentsShowcase />;
}
```

## 🔗 Resources

- [Animate UI Documentation](https://animate-ui.com/docs)
- [Motion Documentation](https://motion.dev)
- [Radix UI Documentation](https://www.radix-ui.com)
- [shadcn/ui](https://ui.shadcn.com)
