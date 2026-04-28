# 🚀 Animated Components - Quick Reference

## Import Statements

```tsx
// Checkbox
import { Checkbox } from "@/components/ui/checkbox";

// Switch
import { Switch } from "@/components/ui/switch";

// Animated Badge
import { AnimatedBadge } from "@/components/ui/animated-badge";

// Animated Card
import { 
  AnimatedCard, 
  AnimatedCardHeader,
  AnimatedCardTitle,
  AnimatedCardDescription,
  AnimatedCardContent,
  AnimatedCardFooter
} from "@/components/ui/animated-card";

// Animated Input
import { AnimatedInput } from "@/components/ui/animated-input";
```

---

## Checkbox

```tsx
// Basic
<Checkbox 
  checked={value}
  onCheckedChange={(checked) => setValue(checked === true)}
/>

// With label
<div className="flex items-center gap-2">
  <Checkbox id="terms" checked={accepted} onCheckedChange={setAccepted} />
  <Label htmlFor="terms">Accept terms</Label>
</div>

// Sizes
<Checkbox size="sm" />    // Small
<Checkbox size="default" /> // Default
<Checkbox size="lg" />    // Large

// Variants
<Checkbox variant="default" />
<Checkbox variant="accent" />

// Disabled
<Checkbox disabled />
```

---

## Switch

```tsx
// Basic
<Switch 
  checked={enabled}
  onCheckedChange={setEnabled}
/>

// With label
<div className="flex items-center justify-between">
  <Label htmlFor="notifications">Notifications</Label>
  <Switch id="notifications" checked={enabled} onCheckedChange={setEnabled} />
</div>

// Sizes
<Switch size="sm" />      // Small
<Switch size="default" /> // Default

// Disabled
<Switch disabled />
```

---

## Animated Badge

```tsx
// Basic variants
<AnimatedBadge variant="default">Default</AnimatedBadge>
<AnimatedBadge variant="secondary">Secondary</AnimatedBadge>
<AnimatedBadge variant="destructive">Error</AnimatedBadge>
<AnimatedBadge variant="outline">Outline</AnimatedBadge>

// Status variants
<AnimatedBadge variant="success">Active</AnimatedBadge>
<AnimatedBadge variant="warning">Pending</AnimatedBadge>
<AnimatedBadge variant="info">Info</AnimatedBadge>
<AnimatedBadge variant="muted">Inactive</AnimatedBadge>

// Without animation
<AnimatedBadge animate={false}>Static</AnimatedBadge>
```

---

## Animated Card

```tsx
// Basic
<AnimatedCard>
  <AnimatedCardContent>
    Content here
  </AnimatedCardContent>
</AnimatedCard>

// Full structure
<AnimatedCard hoverScale={1.03} tapScale={0.97}>
  <AnimatedCardHeader>
    <AnimatedCardTitle>Title</AnimatedCardTitle>
    <AnimatedCardDescription>Description</AnimatedCardDescription>
  </AnimatedCardHeader>
  <AnimatedCardContent>
    Main content
  </AnimatedCardContent>
  <AnimatedCardFooter>
    Footer content
  </AnimatedCardFooter>
</AnimatedCard>

// Custom hover scale
<AnimatedCard hoverScale={1.05}>
  Content
</AnimatedCard>

// No hover effect
<AnimatedCard hoverScale={1}>
  Content
</AnimatedCard>
```

---

## Animated Input

```tsx
// Basic
<AnimatedInput 
  placeholder="Enter text..."
  value={value}
  onChange={(e) => setValue(e.target.value)}
/>

// With label
<div className="space-y-2">
  <Label htmlFor="email">Email</Label>
  <AnimatedInput 
    id="email"
    type="email"
    placeholder="you@example.com"
  />
</div>

// Error state
<AnimatedInput 
  error={hasError}
  placeholder="This field has an error"
/>

// Disabled
<AnimatedInput disabled />
```

---

## Common Patterns

### Form with Checkbox
```tsx
<form className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="name">Name</Label>
    <AnimatedInput id="name" />
  </div>
  
  <div className="flex items-center gap-2">
    <Checkbox id="subscribe" />
    <Label htmlFor="subscribe">Subscribe to newsletter</Label>
  </div>
  
  <Button type="submit">Submit</Button>
</form>
```

### Settings Panel
```tsx
<AnimatedCard>
  <AnimatedCardHeader>
    <AnimatedCardTitle>Settings</AnimatedCardTitle>
  </AnimatedCardHeader>
  <AnimatedCardContent className="space-y-4">
    <div className="flex items-center justify-between">
      <Label>Enable notifications</Label>
      <Switch checked={notifications} onCheckedChange={setNotifications} />
    </div>
    
    <div className="flex items-center justify-between">
      <Label>Dark mode</Label>
      <Switch checked={darkMode} onCheckedChange={setDarkMode} />
    </div>
  </AnimatedCardContent>
</AnimatedCard>
```

### Status Badges
```tsx
<div className="flex gap-2">
  {order.status === 'active' && (
    <AnimatedBadge variant="success">Active</AnimatedBadge>
  )}
  {order.status === 'pending' && (
    <AnimatedBadge variant="warning">Pending</AnimatedBadge>
  )}
  {order.status === 'cancelled' && (
    <AnimatedBadge variant="destructive">Cancelled</AnimatedBadge>
  )}
</div>
```

### Card Grid
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  {items.map((item) => (
    <AnimatedCard key={item.id} hoverScale={1.03}>
      <AnimatedCardContent className="p-6">
        <h3 className="font-semibold">{item.title}</h3>
        <p className="text-sm text-muted-foreground">{item.description}</p>
      </AnimatedCardContent>
    </AnimatedCard>
  ))}
</div>
```

---

## Animation Customization

### Timing Values
```tsx
// In component file
transition={{
  type: "spring",
  stiffness: 500,  // 300-700 (higher = faster)
  damping: 30,     // 15-40 (higher = less bounce)
  mass: 1          // 0.5-2 (higher = heavier)
}}
```

### Presets
- **Snappy**: `stiffness: 700, damping: 30`
- **Smooth**: `stiffness: 300, damping: 25`
- **Bouncy**: `stiffness: 500, damping: 15`

---

## Accessibility

All components maintain full accessibility:
- ✅ Keyboard navigation
- ✅ Screen reader support
- ✅ Focus indicators
- ✅ ARIA attributes
- ✅ Respects `prefers-reduced-motion`

---

## TypeScript

All components are fully typed:
```tsx
import type { CheckboxProps } from "@radix-ui/react-checkbox";
import type { AnimatedBadgeProps } from "@/components/ui/animated-badge";
import type { AnimatedCardProps } from "@/components/ui/animated-card";
```

---

## Common Gotchas

### ❌ Wrong
```tsx
<Checkbox onChange={(e) => setValue(e.target.checked)} />
```

### ✅ Correct
```tsx
<Checkbox onCheckedChange={(checked) => setValue(checked === true)} />
```

---

### ❌ Wrong
```tsx
<Switch onChange={setEnabled} />
```

### ✅ Correct
```tsx
<Switch onCheckedChange={setEnabled} />
```

---

## Documentation

- **Full API**: `docs/ANIMATED_COMPONENTS.md`
- **Migration Guide**: `docs/MIGRATION_TO_ANIMATED_UI.md`
- **Overview**: `ANIMATE_UI_INTEGRATION.md`
- **Showcase**: `components/examples/AnimatedComponentsShowcase.tsx`

---

## Resources

- [Animate UI](https://animate-ui.com)
- [Motion Docs](https://motion.dev)
- [Radix UI](https://www.radix-ui.com)
- [shadcn/ui](https://ui.shadcn.com)
