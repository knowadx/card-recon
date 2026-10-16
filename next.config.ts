import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // build autocontido (.next/standalone) para a imagem Docker — padrão do Hash (VPS + Docker)
  output: "standalone",
};

export default nextConfig;
