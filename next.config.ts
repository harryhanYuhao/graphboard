import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@xyflow/react", "katex"],
  },
};;

export default nextConfig;
