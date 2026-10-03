import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@linktide/discovery", "@linktide/lm-studio"]
};

export default nextConfig;
