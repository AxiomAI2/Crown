/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite — серверный WASM-пакет (локальный Postgres); не бандлим его, грузим как внешний на сервере.
  serverExternalPackages: ["@electric-sql/pglite"],
  webpack: (config) => {
    // Опциональные зависимости wallet/ws-стека, которых нет и не нужно — гасим resolve-варнинги.
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "pino-pretty": false,
      lokijs: false,
      encoding: false,
    };
    return config;
  },
};

export default nextConfig;
