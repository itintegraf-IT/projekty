export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "PRESET_INVALID"
  | "SCHEDULE_VIOLATION"
  | "CONFLICT";

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
