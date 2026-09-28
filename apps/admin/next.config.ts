import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: ["@conditional-stocks/market-data", "@conditional-stocks/evm-client"],
  poweredByHeader: false,
};
export default nextConfig;
