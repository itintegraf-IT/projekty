/** @type {import('next').NextConfig} */
const nextConfig = {
  // Aplikace next/image nepoužívá (jen <img>) — vypnutím optimalizace se
  // deaktivuje endpoint /_next/image (vrací 404) a s ním zneužitelnost
  // vendorovaného sharp/libvips. POZOR: sharp zůstává v lockfile (závislost
  // Nextu bez non-breaking fixu), takže `npm audit` ho hlásí dál — je ale
  // nedosažitelný.
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
