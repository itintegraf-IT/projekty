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
      // POZOR: PM2 tady měří jen npm wrapper (~50-80 MB), ne skutečný
      // next-server child — na skutečnou spotřebu serveru tenhle limit nedosáhne.
      // Tvrdý strop haldy přes NODE_OPTIONS tu ZÁMĚRNĚ NENÍ: dokud na produkci
      // nezměříme reálnou špičku (`ps -o rss=,cmd= -C node` ve střídání směn),
      // byl by to odhad naslepo — a při jeho překročení proces spadne a všem
      // u strojů na dobu restartu zmizí plán. Přidat až s naměřenou hodnotou
      // a ~2× rezervou (rozhodnuto při go/no-go auditu 3. 8. 2026).
      max_memory_restart: "1G",
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
