import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { buildUserFacets, type UserFacet } from "@/lib/auditFacets";

interface FilterFacets {
  users: UserFacet[];
  actions: string[];
}

interface CacheEntry {
  expiresAt: number;
  data: FilterFacets;
}

const CACHE_TTL_MS = 60_000;
const FACET_HARD_CAP = 500;

let cache: CacheEntry | null = null;
// In-flight promise dedup — když N requestů přijde po expiraci, fetchne jen jeden.
let inflight: Promise<FilterFacets> | null = null;

async function loadFacets(): Promise<FilterFacets> {
  const [users, auditUsernameRows, actionRows] = await Promise.all([
    prisma.user.findMany({
      select: { username: true, role: true },
      take: FACET_HARD_CAP,
    }),
    prisma.auditLog.findMany({
      distinct: ["username"],
      select: { username: true },
      orderBy: { username: "asc" },
      take: FACET_HARD_CAP,
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: FACET_HARD_CAP,
    }),
  ]);

  const activeUsernames = auditUsernameRows
    .map((r) => r.username)
    .filter((s) => s.length > 0);

  return {
    users: buildUserFacets(users, activeUsernames),
    actions: actionRows.map((r) => r.action).filter((s) => s.length > 0),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json(cache.data);
  }

  try {
    if (!inflight) {
      inflight = loadFacets().finally(() => {
        // Promise se "spotřebuje" až `cache` updatne první vítěz race;
        // ostatní callers vrátí stejnou hodnotu skrz `await`.
      });
    }
    const data = await inflight;
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, data };
    inflight = null;
    return NextResponse.json(data);
  } catch (error) {
    inflight = null;
    logger.error("[GET /api/audit/filters]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
