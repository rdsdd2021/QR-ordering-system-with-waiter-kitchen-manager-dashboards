import Link from "next/link";
import { QrCode, ArrowLeft } from "lucide-react";

export const metadata = { title: "Privacy Policy – QR Order" };

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mt-2">Last updated: April 2025</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">1. Introduction</h2>
            <p>
              This Privacy Policy describes how <strong className="text-foreground">QR Order</strong> (a product of Assistt, "we", "us", "our") collects, uses, and protects information through our web platform at <strong className="text-foreground">https://qrorder.in/</strong>. By using the Platform, you agree to the practices described here.
            </p>
            <p className="mt-2">
              Your data is primarily stored and processed in India via Supabase (our database provider) and Stripe (our payment processor), both of which maintain industry-standard security practices.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">2. Information We Collect</h2>
            <p className="mb-2">We collect the following categories of information:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Restaurant account data:</strong> Name, email address, restaurant name, and profile information provided during registration.</li>
              <li><strong className="text-foreground">Staff data:</strong> Names, roles, and email addresses of staff members (waiters, kitchen staff, managers) added to your account.</li>
              <li><strong className="text-foreground">Customer order data:</strong> Customer names, phone numbers, party size, and order details collected at the time of ordering via QR code.</li>
              <li><strong className="text-foreground">Menu &amp; operational data:</strong> Menu items, pricing, table configurations, floor plans, and order history.</li>
              <li><strong className="text-foreground">Payment data:</strong> Subscription billing is handled by Stripe. We do not store card numbers or sensitive payment details on our servers.</li>
              <li><strong className="text-foreground">Usage data:</strong> Log data, IP addresses, browser type, and feature usage patterns for analytics and improvement.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To provide and operate the QR ordering, kitchen display, and analytics features.</li>
              <li>To process subscription payments and send billing notifications.</li>
              <li>To send service-related communications (order alerts, account updates, security notices).</li>
              <li>To improve the Platform through aggregated usage analytics.</li>
              <li>To comply with legal obligations and enforce our Terms of Use.</li>
            </ul>
            <p className="mt-2">We do not sell your personal data to third parties.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">4. Data Sharing</h2>
            <p className="mb-2">We share data only with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Supabase:</strong> Our database and authentication provider (data stored in India/EU regions).</li>
              <li><strong className="text-foreground">Stripe:</strong> Our payment processor for subscription billing.</li>
              <li><strong className="text-foreground">Law enforcement:</strong> When required by law or court order.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">5. Data Retention</h2>
            <p>
              We retain your account and order data for as long as your account is active. Upon account deletion, your data is removed within 30 days, except where retention is required by law or for fraud prevention. Order history may be retained in anonymised form for analytics.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">6. Security</h2>
            <p>
              We use industry-standard security measures including encrypted connections (HTTPS), row-level security on our database, and secure authentication. However, no internet transmission is completely secure, and you use the Platform at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">7. Your Rights</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Access and update your account information from your dashboard settings.</li>
              <li>Request deletion of your account and associated data by contacting us.</li>
              <li>Withdraw consent for marketing communications at any time.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">8. Cookies</h2>
            <p>
              We use essential cookies for authentication and session management. We do not use third-party advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. We will notify registered users of significant changes via email. Continued use of the Platform after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">10. Grievance Officer</h2>
            <p>For privacy concerns or data requests, contact:</p>
            <div className="mt-2 p-4 rounded-xl border bg-card space-y-1">
              <p><strong className="text-foreground">QR Order – Grievance Officer</strong></p>
              <p>Assistt, Deshbandhu Para, Siliguri, West Bengal</p>
              <p>Email: <a href="mailto:support@assistt.in" className="text-primary hover:underline">support@assistt.in</a></p>
              <p>Hours: Monday – Friday, 9:00 AM – 6:00 PM IST</p>
            </div>
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
