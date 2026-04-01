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
      env: {
        NODE_ENV: "production",
        // next start respektuje PORT
        PORT: process.env.PORT || "3020",
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        ALLOW_HTTP_SESSION: process.env.ALLOW_HTTP_SESSION,
      },
    },
  ],
};
