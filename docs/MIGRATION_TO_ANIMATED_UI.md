# Migration Guide: Adding Animated Components

This guide shows you how to replace standard HTML inputs with animated components throughout your app.

## ✅ Completed Migrations

### Checkboxes
**Before:**
```tsx
<input 
  type="checkbox" 
  checked={isActive}
  onChange={(e) => setIsActive(e.target.checked)}
  className="h-4 w-4"
/>
```

**After:**
```tsx
import { Checkbox } from "@/components/ui/checkbox";

<Checkbox 
  checked={isActive}
  onCheckedChange={(checked) => setIsActive(checked === true)}
/>
```

**Files Updated:**
- ✅ `components/admin/CouponManager.tsx` (+ icon button hover transitions)
- ✅ `components/admin/PlanManager.tsx`
- ✅ `components/manager/bulk-upload/BulkEditTab.tsx`

### Table Row Hover States
**Before:**
```tsx
<tr className="hover:bg-muted/30">
  {/* Table row content */}
</tr>
```

**After:**
```tsx
<tr className="hover:bg-muted/50 dark:hover:bg-muted/30 transition-colors">
  {/* Table row content with smooth color transitions */}
</tr>
```

**Features:**
- Smooth color transitions on hover
- Dark mode optimized hover states
- Improved visual feedback for interactive rows

**Files Updated:**
- ✅ `app/admin/AdminClient.tsx`

### Menu Item Cards
**Before:**
```tsx
<div className="flex gap-3 rounded-lg bg-card p-3.5 border">
  {/* Static card content */}
</div>
```

**After:**
```tsx
import { motion } from "motion/react";

<motion.div 
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  whileHover={{ scale: 1.02 }}
  transition={{ type: "spring", stiffness: 300, damping: 20 }}
  className="flex gap-3 rounded-lg bg-card p-3.5 border"
>
  {/* Animated card content with animated tags */}
</motion.div>
```

**Files Updated:**
- ✅ `components/MenuItemCard.tsx`

### Status Badges
**Before:**
```tsx
<span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium status-active">
  Active
</span>
```

**After:**
```tsx
import { StatusBadge } from "@/components/ui/status-badge";

<StatusBadge status="active" />
// or with custom label
<StatusBadge status="preparing" label="In Progress" dot />
// disable animation if needed
<StatusBadge status="ready" animate={false} />
```

**Features:**
- Entrance animation (scale + fade)
- Hover scale effect
- Optional pulsing dot indicator
- Can disable animations with `animate={false}`

**Files Updated:**
- ✅ `components/ui/status-badge.tsx`

---

## 🔄 Recommended Future Migrations

### 1. Radio Buttons
Look for radio button groups and replace with animated Radix UI Radio Group.

**Search for:**
```bash
grep -r "type=\"radio\"" components/
```

### 2. Select Dropdowns
Replace native `<select>` with animated Select component.

**Search for:**
```bash
grep -r "<select" components/
```

**Example Migration:**
```tsx
// Before
<select value={value} onChange={(e) => setValue(e.target.value)}>
  <option value="1">Option 1</option>
</select>

// After
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Select..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="1">Option 1</SelectItem>
  </SelectContent>
</Select>
```

### 3. Dialogs/Modals
Add entrance animations to existing Dialog components.

**Files to Check:**
- `components/admin/CouponManager.tsx` (already uses Dialog)
- `components/admin/PlanManager.tsx` (already uses Dialog)
- Any other modal/dialog usage

**Enhancement:**
```tsx
import { motion } from "motion/react";

<DialogContent asChild>
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    transition={{ type: "spring", stiffness: 300, damping: 25 }}
  >
    {/* Dialog content */}
  </motion.div>
</DialogContent>
```

### 4. Buttons with Loading States
Add animated loading spinners to buttons.

**Example:**
```tsx
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";

<Button disabled={loading}>
  {loading && (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    >
      <Loader2 className="h-4 w-4" />
    </motion.div>
  )}
  Save
</Button>
```

### 5. Cards
Replace static Card components with AnimatedCard.

**Before:**
```tsx
import { Card } from "@/components/ui/card";

<Card>Content</Card>
```

**After:**
```tsx
import { AnimatedCard } from "@/components/ui/animated-card";

<AnimatedCard>Content</AnimatedCard>
```

### 6. Badges
Replace Badge with AnimatedBadge for status indicators.

**Before:**
```tsx
import { Badge } from "@/components/ui/badge";

<Badge variant="success">Active</Badge>
```

**After:**
```tsx
import { AnimatedBadge } from "@/components/ui/animated-badge";

<AnimatedBadge variant="success">Active</AnimatedBadge>
```

---

## 🎯 Priority Migration List

### High Priority (User-facing, frequently used)
1. ✅ Checkboxes in admin panels
2. ✅ Checkboxes in bulk edit
3. ✅ Menu item cards (entrance animations + hover effects)
4. ✅ Status badges (StatusBadge component with animations)
5. ✅ Icon button hover states (smooth color transitions)
6. ✅ Table row hover states (smooth transitions + dark mode)
7. 🔲 Table status indicators

### Medium Priority (Admin/Manager features)
1. 🔲 Settings panel switches (already animated)
2. 🔲 Dialog modals
3. 🔲 Dropdown selects
4. 🔲 Radio button groups

### Low Priority (Less frequently used)
1. 🔲 Tooltips
2. 🔲 Popovers
3. 🔲 Accordions

---

## 🔍 Finding Components to Migrate

### Search Commands

**Find all checkboxes:**
```bash
grep -r "type=\"checkbox\"" components/ --include="*.tsx"
```

**Find all selects:**
```bash
grep -r "<select" components/ --include="*.tsx"
```

**Find all radio buttons:**
```bash
grep -r "type=\"radio\"" components/ --include="*.tsx"
```

**Find all cards:**
```bash
grep -r "from \"@/components/ui/card\"" components/ --include="*.tsx"
```

**Find all badges:**
```bash
grep -r "from \"@/components/ui/badge\"" components/ --include="*.tsx"
```

---

## 📋 Migration Checklist

For each component migration:

- [ ] Import the animated component
- [ ] Replace the old component
- [ ] Update event handlers (e.g., `onChange` → `onCheckedChange`)
- [ ] Update value handling (e.g., `e.target.checked` → `checked === true`)
- [ ] Test the component in the UI
- [ ] Check for TypeScript errors
- [ ] Verify accessibility (keyboard navigation, screen readers)
- [ ] Test dark mode
- [ ] Check mobile responsiveness

---

## 🐛 Common Issues & Solutions

### Issue: "Cannot find module '@/components/ui/checkbox'"
**Solution:** Make sure the file exists at `components/ui/checkbox.tsx`

### Issue: TypeScript error on `onCheckedChange`
**Solution:** Use `checked === true` to convert `boolean | "indeterminate"` to `boolean`
```tsx
onCheckedChange={(checked) => setValue(checked === true)}
```

### Issue: Animation not working
**Solution:** Ensure the component has `"use client"` directive at the top

### Issue: Checkbox not responding to clicks
**Solution:** Make sure you're using `onCheckedChange` not `onChange`

---

## 🎨 Customization Tips

### Adjust Animation Speed
```tsx
// Faster
<Checkbox /> // Uses default spring: stiffness: 500, damping: 30

// Slower (modify in checkbox.tsx)
transition={{
  type: "spring",
  stiffness: 300,  // Lower = slower
  damping: 25
}}
```

### Disable Animations Conditionally
```tsx
<AnimatedBadge animate={!prefersReducedMotion}>
  Status
</AnimatedBadge>
```

### Custom Variants
Add new variants to `checkbox.tsx`:
```tsx
const variantClasses = {
  default: "...",
  accent: "...",
  success: "border-green-500 data-[state=checked]:bg-green-500",
}
```

---

## 📚 Additional Resources

- [Animate UI Components](https://animate-ui.com/docs/components)
- [Motion Documentation](https://motion.dev/docs)
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [Project Documentation](./ANIMATED_COMPONENTS.md)
- [Live Showcase](/demo) - Interactive demo of all components (visit `/demo` in your browser)
