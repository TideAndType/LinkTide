import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@linktide/classifier",
    "@linktide/discovery",
    "@linktide/lm-studio",
    "@linktide/search"
  ]
};

export default nextConfig;
