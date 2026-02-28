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
  },
  async headers() {
    return [
      {
        source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0",
          },
        ],
      },
    ];
  }
};

export default nextConfig;
