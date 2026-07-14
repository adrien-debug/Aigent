import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  // Self-hosted in a Docker container on gpu1: emit .next/standalone so the
  // image ships only the server + its used deps (no full node_modules).
  output: "standalone",
  images: {
    // Project header/logo images are arbitrary https URLs stored in DB —
    // no fixed host to allowlist, hence the wildcard hostname.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
