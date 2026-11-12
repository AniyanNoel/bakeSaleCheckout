import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in this app shows live financial data, so nothing is cached
  // between requests. Cache Components is deliberately left off.
  serverExternalPackages: ["pg", "exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
