import type { NextConfig } from "next";

const config: NextConfig = {
  async headers() {
    return [
      {
        // The widget loader and the embeddable board must be reachable from
        // any host page; everything else stays same-origin.
        source: "/(widget.js|embed/.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/api/public/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Headers", value: "content-type, authorization" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
        ],
      },
    ];
  },
};

export default config;
