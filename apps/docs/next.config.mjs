import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  agentRules: false,
  output: "export",
  reactStrictMode: true,
};

export default withMDX(config);
