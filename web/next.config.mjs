/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/opengraph-image.png",
        destination: "/opengraph-image",
        permanent: false,
      },
      {
        source: "/twitter-image.png",
        destination: "/twitter-image",
        permanent: false,
      },
      // Legacy route redirects
      {
        source: "/discover",
        destination: "/explore",
        permanent: true,
      },
      {
        source: "/discover/:path*",
        destination: "/explore/:path*",
        permanent: true,
      },
      {
        source: "/assets",
        destination: "/explore?tab=venues",
        permanent: true,
      },
      {
        source: "/assets/:path*",
        destination: "/explore/:path*",
        permanent: true,
      },
      {
        source: "/composition",
        destination: "/structure",
        permanent: true,
      },
      {
        source: "/composition/:path*",
        destination: "/structure/:path*",
        permanent: true,
      },
      {
        source: "/chains",
        destination: "/structure?tab=chains",
        permanent: true,
      },
      {
        source: "/chains/:path*",
        destination: "/structure/:path*",
        permanent: true,
      },
      {
        source: "/changes",
        destination: "/momentum",
        permanent: true,
      },
      {
        source: "/changes/:path*",
        destination: "/momentum/:path*",
        permanent: true,
      },
      {
        source: "/regimes",
        destination: "/momentum?tab=regimes",
        permanent: true,
      },
      {
        source: "/regimes/:path*",
        destination: "/momentum/:path*",
        permanent: true,
      },
    ];
  },
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
