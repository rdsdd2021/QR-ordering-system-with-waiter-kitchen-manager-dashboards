import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this project directory
    root: path.resolve(__dirname),
  },
  // Allow mobile device access to dev server (for testing on local network)
  allowedDevOrigins: ['192.168.31.33'],

  // ── Image optimisation ────────────────────────────────────────────────────
  images: {
    // Serve modern formats (avif first, then webp) — reduces image payload ~50%
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Unsplash placeholder images used in Analytics / MenuManager
      { protocol: "https", hostname: "images.unsplash.com" },
      // Supabase Storage (uploaded menu item images)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },

  // ── Bundle optimisation ───────────────────────────────────────────────────
  experimental: {
    // Tree-shake large icon/UI packages — only bundle what's imported
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },

  // Remove the X-Powered-By header (minor security + response size win)
  poweredByHeader: false,
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "assistt",
  project: "javascript-nextjs",
});
