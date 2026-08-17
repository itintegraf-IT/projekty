export type AppErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PRESET_INVALID"
  | "SCHEDULE_VIOLATION"
  | "CONFLICT"
  | "OVERLAP"
  | "AUTO_SHIFT_FAILED"
  | "VALIDATION_ERROR"
  // Fix round finální recenze (Important 4, 17. 8. 2026): měření kaskády
  // (`detectCalendarDrift`) uvnitř transakce PUT /api/machine-week-shifts selhalo
  // dřív, než se cokoliv zapsalo — odlišuje se od obecné 500, aby v logu i pro
  // uživatele bylo poznat, že selhalo MĚŘENÍ dopadu na kalendář, ne zápis směn.
  | "MEASUREMENT_FAILED";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Kanonické mapování AppErrorCode → HTTP status (audit #80).
 *
 * Do 7/2026 existovalo 7 lokálních kopií této mapy v API routes s rozdíly
 * (SCHEDULE_VIOLATION 500 v machine-week-shifts, VALIDATION_ERROR 500 v reflow,
 * NOT_FOUND 400 v shift-assignments). Toto je jediný zdroj pravdy — v catch
 * bloku API route použij:
 *
 *   if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
 */
export function errorStatus(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
    case "PRESET_INVALID":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "OVERLAP":
    case "AUTO_SHIFT_FAILED":
      return 409;
    case "SCHEDULE_VIOLATION":
      return 422;
    default:
      return 500;
  }
}
