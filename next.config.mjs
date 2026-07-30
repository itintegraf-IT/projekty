/** @type {import('next').NextConfig} */
const nextConfig = {
  // Aplikace next/image nepoužívá (jen <img>) — vypnutím optimalizace se
  // deaktivuje endpoint /_next/image (vrací 404) a s ním zneužitelnost
  // vendorovaného sharp/libvips. POZOR: sharp zůstává v lockfile (závislost
  // Nextu bez non-breaking fixu), takže `npm audit` ho hlásí dál — je ale
  // nedosažitelný.
  images: { unoptimized: true },
  // Neprozrazovat verzi frameworku.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
  // Bezpečnostní hlavičky (audit SEC-06). HSTS záměrně NENÍ — nasazení jede
  // vědomě na HTTP uvnitř VPN (viz docs/DEPLOY_WORKFLOW.md).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 'self', NE DENY — kioskový launcher /vyroba-terminal.html
          // vkládá plán do vlastního iframu.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
