import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  // Keep local development unchanged; containers use the minimal Node server.
  output: process.env.CLOUD_RUN_BUILD === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
};

export default config;
