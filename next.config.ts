import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this project directory
    root: path.resolve(__dirname),
  },
  // Allow mobile device access to dev server (for testing on local network)
  allowedDevOrigins: ['192.168.31.33'],
};

export default nextConfig;
