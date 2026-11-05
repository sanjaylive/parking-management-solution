import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@park2all/web-ui'],
  // Self-contained server bundle for the VPS (node server.js); tracing must start at the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Mounted under a sub-path in production (e.g. /operator); empty in development.
  basePath: process.env.NEXT_BASE_PATH || undefined,
  // <img> and other raw asset URLs need the base path too.
  env: { NEXT_PUBLIC_BASE_PATH: process.env.NEXT_BASE_PATH || '' },
};
export default config;
