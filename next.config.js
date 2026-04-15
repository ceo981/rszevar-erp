const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pdf-parse Next.js fix
      config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    }
    return config;
  },
  serverExternalPackages: ['pdf-parse'],
};

module.exports = nextConfig;
