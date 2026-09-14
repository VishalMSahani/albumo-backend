import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    integrations: [Sentry.httpIntegration()],
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        // Auth bodies/URLs contain passwords, OTPs and single-use recovery links.
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split("?")[0]!;
        for (const key of Object.keys(event.request.headers ?? {})) {
          if (/authorization|cookie|csrf/i.test(key)) delete event.request.headers![key];
        }
      }
      return event;
    },
  });
}

export { Sentry };
