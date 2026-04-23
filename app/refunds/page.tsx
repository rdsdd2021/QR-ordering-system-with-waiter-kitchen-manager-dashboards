import Link from "next/link";
import { QrCode, ArrowLeft } from "lucide-react";

export const metadata = { title: "Refund & Cancellation Policy – QR Order" };

export default function RefundsPage() {
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
          <h1 className="text-3xl font-bold">Refund &amp; Cancellation Policy</h1>
          <p className="text-sm text-muted-foreground mt-2">Last updated: April 2025</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">

          <p>
            QR Order is a software-as-a-service (SaaS) platform. This policy outlines how subscription cancellations and refunds are handled.
          </p>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">1. Free Trial</h2>
            <p>
              All new accounts receive a <strong className="text-foreground">7-day free trial</strong> of the Pro Plan with no credit card required. You will not be charged during the trial period. If you do not upgrade before the trial ends, your account will revert to the Free Plan automatically.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">2. Subscription Cancellation</h2>
            <p>
              You may cancel your Pro Plan subscription at any time from your <strong className="text-foreground">Billing</strong> settings in the dashboard. Upon cancellation:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Your Pro Plan access continues until the end of the current billing period.</li>
              <li>You will not be charged for the next billing cycle.</li>
              <li>Your account and data are retained and you can resubscribe at any time.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">3. Refunds</h2>
            <p className="mb-2">
              As a digital SaaS product, subscription fees are generally <strong className="text-foreground">non-refundable</strong> once a billing cycle has started. However, we consider refund requests in the following cases:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Accidental charge:</strong> If you were charged after cancelling, contact us within 7 days and we will issue a full refund.</li>
              <li><strong className="text-foreground">Service unavailability:</strong> If the Platform was unavailable for more than 24 consecutive hours in a billing period due to our fault, you may request a pro-rated refund for that period.</li>
              <li><strong className="text-foreground">Duplicate charge:</strong> Any duplicate charges will be refunded in full.</li>
            </ul>
            <p className="mt-2">
              Refund requests must be submitted within <strong className="text-foreground">7 days</strong> of the charge to <a href="mailto:support@assistt.in" className="text-primary hover:underline">support@assistt.in</a>. Approved refunds are processed within <strong className="text-foreground">7–10 business days</strong> to your original payment method.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">4. Non-Refundable Items</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Subscription fees for periods already used.</li>
              <li>Fees paid using promotional coupons or discounts.</li>
              <li>Charges from the current billing period if the service was actively used.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">5. Account Deletion</h2>
            <p>
              Deleting your account does not automatically trigger a refund. Please cancel your subscription first, then delete your account after the billing period ends to avoid further charges.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">6. Contact Us</h2>
            <p>
              For refund or cancellation requests, email us at{" "}
              <a href="mailto:support@assistt.in" className="text-primary hover:underline">support@assistt.in</a>{" "}
              with your registered email address and a description of the issue.
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
        <p className="mt-2">© {new Date().getFullYear()} <strong className="text-foreground">Assistt</strong> · QR Order · All rights reserved</p>

      </footer>
    </div>
  );
}
