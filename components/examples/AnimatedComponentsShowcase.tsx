"use client";

/**
 * Animated Components Showcase
 * 
 * This file demonstrates all the animated components available in the app.
 * Use this as a reference for implementing animations in your features.
 * 
 * To view this showcase, import it in any page:
 * import AnimatedComponentsShowcase from "@/components/examples/AnimatedComponentsShowcase";
 */

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { AnimatedBadge } from "@/components/ui/animated-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { AnimatedCard, AnimatedCardHeader, AnimatedCardTitle, AnimatedCardContent } from "@/components/ui/animated-card";
import { AnimatedInput } from "@/components/ui/animated-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function AnimatedComponentsShowcase() {
  const [checked, setChecked] = useState(false);
  const [switchOn, setSwitchOn] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showBadges, setShowBadges] = useState(true);
  const [showStatusBadges, setShowStatusBadges] = useState(true);

  return (
    <div className="container mx-auto p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Animated Components Showcase</h1>
        <p className="text-muted-foreground">
          All animated components available in your app, inspired by Animate UI
        </p>
      </div>

      {/* Checkboxes */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Animated Checkboxes</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Checkbox 
                id="default-checkbox"
                checked={checked}
                onCheckedChange={(c) => setChecked(c === true)}
              />
              <Label htmlFor="default-checkbox" className="cursor-pointer">
                Default size checkbox
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox 
                id="small-checkbox"
                size="sm"
                checked={checked}
                onCheckedChange={(c) => setChecked(c === true)}
              />
              <Label htmlFor="small-checkbox" className="cursor-pointer text-sm">
                Small checkbox
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox 
                id="large-checkbox"
                size="lg"
                checked={checked}
                onCheckedChange={(c) => setChecked(c === true)}
              />
              <Label htmlFor="large-checkbox" className="cursor-pointer">
                Large checkbox
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox 
                id="accent-checkbox"
                variant="accent"
                checked={checked}
                onCheckedChange={(c) => setChecked(c === true)}
              />
              <Label htmlFor="accent-checkbox" className="cursor-pointer">
                Accent variant
              </Label>
            </div>
          </div>
        </AnimatedCardContent>
      </AnimatedCard>

      {/* Switches */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Animated Switches</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="default-switch">Default switch</Label>
            <Switch 
              id="default-switch"
              checked={switchOn}
              onCheckedChange={setSwitchOn}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="small-switch">Small switch</Label>
            <Switch 
              id="small-switch"
              size="sm"
              checked={switchOn}
              onCheckedChange={setSwitchOn}
            />
          </div>
        </AnimatedCardContent>
      </AnimatedCard>

      {/* Badges */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Animated Badges</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setShowBadges(!showBadges)}
            >
              {showBadges ? "Hide" : "Show"} Badges
            </Button>
            <span className="text-sm text-muted-foreground">
              (Watch them animate in/out)
            </span>
          </div>

          {showBadges && (
            <div className="flex flex-wrap gap-2">
              <AnimatedBadge variant="default">Default</AnimatedBadge>
              <AnimatedBadge variant="secondary">Secondary</AnimatedBadge>
              <AnimatedBadge variant="destructive">Destructive</AnimatedBadge>
              <AnimatedBadge variant="outline">Outline</AnimatedBadge>
              <AnimatedBadge variant="success">Success</AnimatedBadge>
              <AnimatedBadge variant="warning">Warning</AnimatedBadge>
              <AnimatedBadge variant="info">Info</AnimatedBadge>
              <AnimatedBadge variant="muted">Muted</AnimatedBadge>
            </div>
          )}

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-2">Without animation:</p>
            <div className="flex flex-wrap gap-2">
              <AnimatedBadge variant="default" animate={false}>Static Badge</AnimatedBadge>
              <AnimatedBadge variant="success" animate={false}>No Animation</AnimatedBadge>
            </div>
          </div>
        </AnimatedCardContent>
      </AnimatedCard>

      {/* Status Badges */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Status Badges</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setShowStatusBadges(!showStatusBadges)}
            >
              {showStatusBadges ? "Hide" : "Show"} Status Badges
            </Button>
            <span className="text-sm text-muted-foreground">
              (Watch them animate in/out)
            </span>
          </div>

          {showStatusBadges && (
            <>
              <div>
                <p className="text-sm font-medium mb-2">Order Status:</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status="preparing" />
                  <StatusBadge status="ready" />
                  <StatusBadge status="served" />
                  <StatusBadge status="cancelled" />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">General Status:</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status="active" />
                  <StatusBadge status="inactive" />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Table Status:</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status="occupied" />
                  <StatusBadge status="available" />
                  <StatusBadge status="reserved" />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Stock Status:</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status="in-stock" />
                  <StatusBadge status="low-stock" />
                  <StatusBadge status="out-of-stock" />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">With Pulsing Dot:</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status="preparing" dot />
                  <StatusBadge status="active" dot />
                  <StatusBadge status="occupied" dot />
                </div>
              </div>
            </>
          )}

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-2">Without animation:</p>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="ready" animate={false} />
              <StatusBadge status="active" animate={false} />
            </div>
          </div>
        </AnimatedCardContent>
      </AnimatedCard>

      {/* Inputs */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Animated Inputs</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="animated-input">Try focusing this input</Label>
            <AnimatedInput
              id="animated-input"
              placeholder="Type something..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Notice the subtle scale animation and focus indicator
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="error-input">Input with error state</Label>
            <AnimatedInput
              id="error-input"
              placeholder="This has an error"
              error={true}
            />
          </div>
        </AnimatedCardContent>
      </AnimatedCard>

      {/* Cards */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Animated Cards</h2>
        <p className="text-muted-foreground">
          Hover over these cards to see the scale effect
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AnimatedCard hoverScale={1.05}>
            <AnimatedCardContent className="p-6">
              <h3 className="font-semibold mb-2">Card 1</h3>
              <p className="text-sm text-muted-foreground">
                Hover me for a subtle scale effect
              </p>
            </AnimatedCardContent>
          </AnimatedCard>

          <AnimatedCard hoverScale={1.05}>
            <AnimatedCardContent className="p-6">
              <h3 className="font-semibold mb-2">Card 2</h3>
              <p className="text-sm text-muted-foreground">
                Each card animates independently
              </p>
            </AnimatedCardContent>
          </AnimatedCard>

          <AnimatedCard hoverScale={1.05}>
            <AnimatedCardContent className="p-6">
              <h3 className="font-semibold mb-2">Card 3</h3>
              <p className="text-sm text-muted-foreground">
                Smooth spring-based animations
              </p>
            </AnimatedCardContent>
          </AnimatedCard>
        </div>
      </div>

      {/* Usage Examples */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Usage Examples</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium">Checkbox</h4>
            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">
{`<Checkbox 
  checked={value}
  onCheckedChange={(checked) => setValue(checked === true)}
  size="default"
  variant="default"
/>`}
            </pre>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Switch</h4>
            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">
{`<Switch 
  checked={enabled}
  onCheckedChange={setEnabled}
  size="default"
/>`}
            </pre>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Animated Badge</h4>
            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">
{`<AnimatedBadge variant="success">
  Active
</AnimatedBadge>`}
            </pre>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Status Badge</h4>
            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">
{`<StatusBadge status="preparing" />
<StatusBadge status="active" dot />
<StatusBadge status="ready" animate={false} />`}
            </pre>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Animated Card</h4>
            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">
{`<AnimatedCard hoverScale={1.03}>
  <AnimatedCardContent>
    Content
  </AnimatedCardContent>
</AnimatedCard>`}
            </pre>
          </div>
        </AnimatedCardContent>
      </AnimatedCard>

      {/* Documentation Links */}
      <AnimatedCard>
        <AnimatedCardHeader>
          <AnimatedCardTitle>Documentation</AnimatedCardTitle>
        </AnimatedCardHeader>
        <AnimatedCardContent className="space-y-2">
          <p className="text-sm">
            For complete documentation, see:
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li><code>docs/ANIMATED_COMPONENTS.md</code> - Component API reference</li>
            <li><code>docs/MIGRATION_TO_ANIMATED_UI.md</code> - Migration guide</li>
            <li><code>ANIMATE_UI_INTEGRATION.md</code> - Integration overview</li>
          </ul>
        </AnimatedCardContent>
      </AnimatedCard>
    </div>
  );
}
