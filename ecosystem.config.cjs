/**
 * PM2 — načte .env s přepsáním starých proměnných z prostředí (např. zastaralý DATABASE_URL s appuser).
 * Spuštění: cd /var/www/planovanivyroby && pm2 start ecosystem.config.cjs
 */
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, ".env"),
  override: true,
});

module.exports = {
  apps: [
    {
      name: "planovanivyroby",
      cwd: __dirname,
      script: "npm",
      args: "start",
      // Pojistka proti memory leaku — PM2 proces nad limitem restartuje.
      max_memory_restart: "512M",
      // Fork mód s JEDINOU instancí je ZÁMĚR: rate-limiter loginů a mapa SSE
      // spojení jsou in-memory per proces — v cluster módu (instances > 1)
      // by přestaly fungovat. NIKDY nepřidávat instances/exec_mode cluster.
      env: {
        NODE_ENV: "production",
        // next start respektuje PORT
        PORT: process.env.PORT || "3020",
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        // Řídí příznak Secure u session cookie. Na HTTP nasazení MUSÍ být
        // "false", jinak prohlížeč cookie zahodí a nikdo se nepřihlásí.
        // Detaily: docs/KIOSK_TERMINAL.md, logika: src/lib/cookieSecurity.ts
        COOKIE_SECURE: process.env.COOKIE_SECURE,
      },
    },
  ],
};
