/**
 * Minimální politika hesel (audit SEC-05 / A-4). Dřív prošlo jednoznakové
 * heslo, což v praxi končí u účtů typu `tiskar/tiskar` na terminálech.
 * Platí jen pro nově zakládaná a měněná hesla — stávající účty se nemění.
 */
export const PASSWORD_MIN_LENGTH = 12;

/** bcrypt cost. 10 bylo pro rok 2026 na spodní hranici. */
export const BCRYPT_COST = 12;

export type PasswordValidation = { ok: true } | { ok: false; error: string };

export function validatePassword(password: unknown, username?: string): PasswordValidation {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Heslo nesmí být prázdné." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Heslo musí mít alespoň ${PASSWORD_MIN_LENGTH} znaků.` };
  }
  // bcrypt bere v potaz jen prvních 72 bajtů — delší heslo je tichá past.
  // TextEncoder místo Buffer: modul se importuje i do klientské komponenty
  // (UsersSection kvůli PASSWORD_MIN_LENGTH) a Buffer v prohlížeči není.
  if (new TextEncoder().encode(password).length > 72) {
    return { ok: false, error: "Heslo je příliš dlouhé (maximálně 72 bajtů)." };
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return { ok: false, error: "Heslo nesmí být shodné s uživatelským jménem." };
  }
  return { ok: true };
}
