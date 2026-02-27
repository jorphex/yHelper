/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
    if (base === "/api") {
      return [
        {
          source: "/api/:path*",
          destination: "http://yhelper-api:8000/api/:path*"
        },
        {
          source: "/health",
          destination: "http://yhelper-api:8000/health"
        }
      ];
    }
    return [];
  }
};

export default nextConfig;

