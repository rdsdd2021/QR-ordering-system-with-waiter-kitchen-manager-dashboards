import { QrCode, Zap, Users, BarChart3, ArrowRight } from "lucide-react";
import Link from "next/link";

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
            <span className="font-semibold text-sm tracking-tight">QR Order</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
              Sign in
            </Link>
            <Link href="/onboarding" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Free to start · No credit card required
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-5">
            QR ordering for<br />
            <span className="text-primary">modern restaurants</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Customers scan a QR code, browse your menu, and order — no app needed. Your kitchen and staff get real-time updates.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/onboarding" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl border bg-card px-6 py-3 text-sm font-semibold hover:bg-muted transition-colors">
              Sign in to dashboard
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4.5 w-4.5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} QR Order
      </footer>
    </div>
  );
}
