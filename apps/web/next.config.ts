import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

// One .env at the repo root serves the app, docker compose and the seed scripts.
const repoRoot = resolve(__dirname, "../..");
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@waypoint/db", "@waypoint/planner"],
  serverExternalPackages: ["pg", "highs"],
  images: { remotePatterns: [{ protocol: "https", hostname: "img.clerk.com" }] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
