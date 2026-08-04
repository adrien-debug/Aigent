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
  experimental: {
    // Turbopack's filesystem cache (beta) is ON BY DEFAULT in Next 16 for dev.
    // On this repo it degrades pathologically as the on-disk store grows: at
    // 1.1 GiB under .next/dev/cache/turbopack, the dev server burned 1000-1620%
    // CPU CONTINUOUSLY while idle — zero requests, zero recompilations — with
    // RSS climbing monotonically (2.4 -> 6.4 GiB in 7 min) until the process
    // died. Measured, not inferred: removing the cache dropped idle CPU to 0%
    // and RSS stabilised then fell; restoring it reproduced 1583% immediately.
    // Removing only the stale v16.2.10 orphan did NOT help — the active cache
    // is the cause. Profile: next-swc tokio workers + V8 concurrent GC marking,
    // 41 .sst files held open.
    // Re-enable only once the beta stops scaling this way; re-measure first.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
