import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this project directory
    root: path.resolve(__dirname),
  },
  // Allow mobile device access to dev server (for testing on local network)
  allowedDevOrigins: ['10.185.93.96'],
};

export default nextConfig;
