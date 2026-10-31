import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.AJO_E2E === "live" ? ".next-live-e2e" : process.env.AJO_E2E === "1" ? ".next-e2e" : ".next",
};

export default nextConfig;
