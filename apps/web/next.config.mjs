/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@omnitower/ui"],
  turbopack: {
    resolveAlias: {
      "@api": "../../apps/api/src",
    },
  },
};

export default nextConfig;
