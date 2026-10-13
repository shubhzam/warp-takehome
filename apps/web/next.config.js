/* global process */

// where /api/* is forwarded, the api listens on 4000 unless API_URL says otherwise
const API_URL = process.env.API_URL ?? "http://localhost:4000";

// hosts besides localhost that may open the dev server. next 16 answers 403 to the hot reload
// socket from any other host and the page then never hydrates, it stays on its server rendered
// "Loading..." state. only matters for next dev, a production build has no such socket
const DEV_ORIGINS = ["127.0.0.1"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: DEV_ORIGINS,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
