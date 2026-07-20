export interface LoginLogRow {
  userId: number | null;
  username: string;
  success: boolean;
  createdAt: Date;
}
export interface UserRow {
  id: number;
  username: string;
  role: string;
}
export interface LoginUserStat {
  userId: number | null;
  username: string;
  role: string | null;
  count30d: number;
  lastLoginAt: string | null;
  failed30d: number;
}
export interface LoginOverview {
  summary: {
    loginsToday: number;
    loginsWeek: number;
    activeUsersWeek: number;
    failed7d: number;
    neverLoggedIn: number;
  };
  users: LoginUserStat[];
}

/**
 * Agreguje 30denní okno LoginLog do souhrnu + statistik po uživatelích.
 * Čistá funkce — hranice období počítá caller (Prague TZ) a předá v `bounds`.
 */
export function buildLoginOverview(
  logs: LoginLogRow[],
  users: UserRow[],
  bounds: { todayStart: Date; weekStart: Date; d7Start: Date },
): LoginOverview {
  const successLogs = logs.filter((l) => l.success);
  const failedLogs = logs.filter((l) => !l.success);

  const loginsToday = successLogs.filter((l) => l.createdAt >= bounds.todayStart).length;
  const loginsWeek = successLogs.filter((l) => l.createdAt >= bounds.weekStart).length;
  const activeUsersWeek = new Set(
    successLogs
      .filter((l) => l.createdAt >= bounds.weekStart && l.userId != null)
      .map((l) => l.userId),
  ).size;
  const failed7d = failedLogs.filter((l) => l.createdAt >= bounds.d7Start).length;

  const usersLoggedIn = new Set(
    successLogs.filter((l) => l.userId != null).map((l) => l.userId),
  );
  const neverLoggedIn = users.filter((u) => !usersLoggedIn.has(u.id)).length;

  const stats: LoginUserStat[] = users.map((u) => {
    const mySuccess = successLogs.filter((l) => l.userId === u.id);
    const myFailed = failedLogs.filter((l) => l.userId === u.id);
    const last = mySuccess.reduce<Date | null>(
      (acc, l) => (acc === null || l.createdAt > acc ? l.createdAt : acc),
      null,
    );
    return {
      userId: u.id,
      username: u.username,
      role: u.role,
      count30d: mySuccess.length,
      failed30d: myFailed.length,
      lastLoginAt: last ? last.toISOString() : null,
    };
  });

  stats.sort((a, b) => {
    if (b.count30d !== a.count30d) return b.count30d - a.count30d;
    return a.username.localeCompare(b.username, "cs");
  });

  return {
    summary: { loginsToday, loginsWeek, activeUsersWeek, failed7d, neverLoggedIn },
    users: stats,
  };
}
