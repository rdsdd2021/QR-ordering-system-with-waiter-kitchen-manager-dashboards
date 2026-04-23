import Link from "next/link";
import { QrCode, ArrowLeft } from "lucide-react";

export const metadata = { title: "Shipping & Delivery Policy – QR Order" };

export default function ShippingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500">
              <QrCode className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-sm">QR Order</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Legal</p>
          <h1 className="text-3xl font-bold">Shipping &amp; Delivery Policy</h1>
          <p className="text-sm text-muted-foreground mt-2">Last updated: April 2025</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">

          <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
            <p className="text-foreground font-medium">QR Order is a fully digital SaaS platform.</p>
            <p className="mt-1">
              There are no physical goods shipped. All services are delivered digitally over the internet. This policy describes how digital access and service delivery works.
            </p>
          </div>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">1. Service Delivery</h2>
            <p>
              Upon successful registration and (where applicable) payment, access to QR Order is granted <strong className="text-foreground">immediately and digitally</strong>. You will receive:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>A confirmation email to your registered email address.</li>
              <li>Immediate access to your restaurant dashboard at <strong className="text-foreground">qrorder.in</strong>.</li>
              <li>The ability to set up your menu, tables, staff, and QR codes right away.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">2. QR Code Delivery</h2>
            <p>
              QR codes for your tables are generated digitally within the platform and can be:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Downloaded as PNG images directly from your Table Setup page.</li>
              <li>Printed by you on any standard printer or sent to a print shop.</li>
            </ul>
            <p className="mt-2">
              We do not ship physical QR code materials. Printing and placement of QR codes at your restaurant is your responsibility.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">3. Subscription Activation</h2>
            <p>
              Pro Plan subscriptions are activated <strong className="text-foreground">instantly</strong> upon successful payment via Stripe. If your payment is successful but access is not granted within 10 minutes, please contact us at{" "}
              <a href="mailto:support@assistt.in" className="text-primary hover:underline">support@assistt.in</a>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">4. Service Availability</h2>
            <p>
              We aim to maintain <strong className="text-foreground">99.9% uptime</strong> for the Platform. Scheduled maintenance will be communicated in advance where possible. We are not liable for service interruptions caused by third-party providers (internet, Supabase, Stripe) or force majeure events.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">5. No Physical Shipping</h2>
            <p>
              Since QR Order does not ship any physical products, shipping carrier policies, delivery timelines, and physical return processes do not apply. For service-related issues, refer to our <Link href="/refunds" className="text-primary hover:underline">Refund &amp; Cancellation Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">6. Contact</h2>
            <p>
              For any questions about service delivery or account access, contact us at{" "}
              <a href="mailto:support@assistt.in" className="text-primary hover:underline">support@assistt.in</a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/refunds" className="hover:text-foreground">Refunds</Link>
          <Link href="/shipping" className="hover:text-foreground">Shipping</Link>
        </div>
        <p className="mt-2">© {new Date().getFullYear()} QR Order · All rights reserved</p>
      </footer>
    </div>
  );
}
