export interface UserFacet {
  username: string;
  role: string | null;
  hasActivity: boolean;
}

/**
 * Poskládá nabídku filtru „Uživatelé" pro audit log: všichni uživatelé
 * z tabulky User (s příznakem, zda mají auditní stopu) + jména z auditu,
 * která už v User nejsou (smazané účty, role=null).
 */
export function buildUserFacets(
  users: { username: string; role: string }[],
  activeUsernames: string[],
): UserFacet[] {
  const activeSet = new Set(activeUsernames);
  const known = new Set(users.map((u) => u.username));

  const facets: UserFacet[] = users.map((u) => ({
    username: u.username,
    role: u.role,
    hasActivity: activeSet.has(u.username),
  }));

  for (const name of activeUsernames) {
    if (!known.has(name)) {
      facets.push({ username: name, role: null, hasActivity: true });
    }
  }

  return facets.sort((a, b) => {
    if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
    return a.username.localeCompare(b.username, "cs");
  });
}
