import { QrCode, Zap, Users, BarChart3, ArrowRight } from "lucide-react";
import Link from "next/link";
import PricingSection from "@/components/PricingSection";
import HomeNav from "@/components/HomeNav";
import { Button } from "@/components/ui/button";

const features = [
  { icon: QrCode,    title: "QR Ordering",       desc: "Customers scan and order instantly from their phone" },
  { icon: Zap,       title: "Real-time Kitchen",  desc: "Orders appear on the kitchen screen the moment they're placed" },
  { icon: Users,     title: "Waiter Dashboard",   desc: "Staff manage tables and serve orders from one view" },
  { icon: BarChart3, title: "Analytics",          desc: "Track revenue, prep times, and popular items" },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <QrCode className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm tracking-tight">QR Order</span>
          </div>
          <HomeNav />
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            7-day free trial · No credit card required
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-5">
            QR ordering for<br />
            <span className="text-primary">modern restaurants</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Customers scan a QR code, browse your menu, and order — no app needed. Your kitchen and staff get real-time updates.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/onboarding" className="inline-flex items-center gap-2">
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">
                Sign in to dashboard
              </Link>
            </Button>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-lg border bg-card p-5 space-y-3 cursor-default"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-bold text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <PricingSection />

        {/* About */}
        <section className="mx-auto max-w-5xl px-6 pb-16 text-center">
          <p className="text-xs text-muted-foreground">
            QR Order is a product of <strong className="text-foreground">Assistt</strong> · India ·{" "}
            <a href="mailto:support@assistt.in" className="hover:text-foreground transition-colors">support@assistt.in</a>
          </p>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4 mb-2">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link href="/refunds" className="hover:text-foreground transition-colors">Refunds</Link>
          <Link href="/shipping" className="hover:text-foreground transition-colors">Shipping</Link>
        </div>
        <p>© {new Date().getFullYear()} <strong className="text-foreground">Assistt</strong> · QR Order · All rights reserved</p>
      </footer>
    </div>
  );
}
