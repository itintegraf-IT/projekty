/** Počet nepřečtených notifikací. */
export function countUnread(items: { isRead: boolean }[]): number {
  return items.filter((n) => !n.isRead).length;
}

/** Počet audit záznamů novějších než lastSeenISO (null = počítat vše). */
export function countNewSince(
  logs: { createdAt: string }[],
  lastSeenISO: string | null,
): number {
  const t = lastSeenISO ? new Date(lastSeenISO).getTime() : 0;
  return logs.filter((l) => new Date(l.createdAt).getTime() > t).length;
}

/** Celkový badge = nepřečtená upozornění + nová aktivita. */
export function totalBadge(notifNew: number, auditNew: number): number {
  return notifNew + auditNew;
}
