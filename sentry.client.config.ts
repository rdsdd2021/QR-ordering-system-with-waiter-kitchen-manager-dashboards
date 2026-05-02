import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  integrations: [
    // Automatic page load / navigation spans + XHR/fetch tracing
    Sentry.browserTracingIntegration(),
    // Record and replay user sessions — mask sensitive text/media by default
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
    // "Report a Bug" widget in the UI
    Sentry.feedbackIntegration({
      colorScheme: "system",
      showBranding: false,
    }),
    // Capture failed HTTP requests (4xx/5xx) as Sentry errors
    Sentry.httpClientIntegration(),
    // Capture console.error calls as Sentry events
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
  ],
  tracesSampleRate: 0.1,
  // Sample 5% of all sessions, 100% of sessions that hit an error
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
  // Propagate traces to your own API; adjust the regex to match your production domain
  tracePropagationTargets: ["localhost", /^https:\/\/qr-order\.vercel\.app\/api/],
  debug: false,
  enabled: process.env.NODE_ENV === "production",
});
