/**
 * Jednoduchý strukturovaný logger pro server-side API routes.
 * V produkci vypisuje JSON (vhodné pro log agregaci).
 * Ve vývoji vypisuje čitelný text s barvami.
 *
 * Záměrně přijímá stejnou signaturu jako console.error / console.warn,
 * takže náhrada je přímočará: s/console.error/logger.error/g
 */

type LogLevel = "info" | "warn" | "error";

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
  return arg;
}

function log(level: LogLevel, label: string, ...rest: unknown[]) {
  const ts = new Date().toISOString();
  if (process.env.NODE_ENV === "production") {
    const entry: Record<string, unknown> = { ts, level, label };
    if (rest.length === 1) entry.data = serializeArg(rest[0]);
    else if (rest.length > 1) entry.data = rest.map(serializeArg);
    process.stdout.write(JSON.stringify(entry) + "\n");
  } else {
    const prefix =
      level === "error" ? "\x1b[31m[ERR]\x1b[0m" :
      level === "warn"  ? "\x1b[33m[WRN]\x1b[0m" :
                          "\x1b[36m[INF]\x1b[0m";
    if (rest.length > 0) {
      console[level === "info" ? "log" : level](`${prefix} ${label}`, ...rest);
    } else {
      console[level === "info" ? "log" : level](`${prefix} ${label}`);
    }
  }
}

export const logger = {
  info:  (label: string, ...rest: unknown[]) => log("info",  label, ...rest),
  warn:  (label: string, ...rest: unknown[]) => log("warn",  label, ...rest),
  error: (label: string, ...rest: unknown[]) => log("error", label, ...rest),
};
