import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Project header/logo images are arbitrary https URLs stored in DB —
    // no fixed host to allowlist, hence the wildcard hostname.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
