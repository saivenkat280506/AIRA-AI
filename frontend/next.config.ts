import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Backend services live one directory above the Next app.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
