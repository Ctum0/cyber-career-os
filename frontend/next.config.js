/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Full backend URL override (e.g. https://api.example.com); falls back to local backend port.
    const baseUrl = process.env.BACKEND_URL
      ? process.env.BACKEND_URL.replace(/\/+$/, '')
      : `http://localhost:${process.env.BACKEND_PORT || 8000}`;
    return [
      {
        source: '/api/:path*',
        destination: `${baseUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
