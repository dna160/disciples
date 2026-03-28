/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'rss-parser',
      'node-cron',
      '@prisma/client',
      '@anthropic-ai/sdk',
    ],
  },
}

module.exports = nextConfig
