import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: ["@conditional-stocks/domain", "@conditional-stocks/evm-client"],
  experimental: {
    optimizePackageImports: ["@conditional-stocks/evm-client", "@conditional-stocks/domain"],
  },
  poweredByHeader: false,
  // Category tabs before the October 2026 topics: shared links land on their nearest tab.
  async redirects() {
    return [
      { source: "/category/macro", destination: "/category/economy", permanent: true },
      { source: "/category/policy", destination: "/category/politics", permanent: true },
      { source: "/category/other", destination: "/", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
