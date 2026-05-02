import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  integrations: [
    // Capture local variable values at the point of an exception — great for debugging
    // payment/webhook/API errors without needing to reproduce them
    Sentry.localVariablesIntegration(),
    // Capture console.error calls as Sentry events
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
  ],
  tracesSampleRate: 0.1,
  debug: false,
  enabled: process.env.NODE_ENV === "production",
});
