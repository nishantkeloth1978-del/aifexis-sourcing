import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default config;
