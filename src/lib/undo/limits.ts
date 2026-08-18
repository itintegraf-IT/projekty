/**
 * Strop operací v JEDNÉ undo/redo dávce.
 *
 * Jediný zdroj pravdy pro obě strany: `sanitizeUndoOps` (`undoApply.server.ts`)
 * nad ním vrací 400, a klient podle něj pozná, že krok historie nemá smysl vůbec
 * zaznamenávat — jinak by Ctrl+Z po velkém přepočtu stroje spadl na
 * „Seznam operací je příliš dlouhý" místo aby uživateli rovnou řekl, že tuhle
 * dávku vrací historie bloku (`docs/superpowers/specs/2026-08-18-…`, etapa D).
 */
export const UNDO_MAX_OPS = 200;
