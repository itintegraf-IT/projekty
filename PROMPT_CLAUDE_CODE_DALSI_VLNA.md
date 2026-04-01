Přečti nejdřív `@SPECIFIKACE_DALSI_VLNY_ZMEN.md`, `@CLAUDE.md`, `@PLAN.md` a relevantní soubory planneru/admin/API. Pracuj nad existujícím repem, ne nad historickým scaffolding promptem v souboru `@Prompt`.

Dodrž tato pravidla:

1. Tato vlna se řídí primárně `@SPECIFIKACE_DALSI_VLNY_ZMEN.md`. Pokud narazíš na rozpor s jinou dokumentací, upozorni na něj a pro implementaci se drž této specifikace.
2. Před větší DB nebo API změnou si udělej krátký implementační plán.
3. Použij paralelní subagenty:
   - 1 na UI (`PlannerPage`, `TimelineGrid`, `AdminDashboard`)
   - 1 na API + Prisma schema
   - 1 na helpery a sdílenou logiku (`workingTime`, date utils, auth guards)
4. Použij dostupné MCP servery projektu, hlavně shadcn, před návrhem nového context submenu nebo dalších UI patternů.
5. Zachovej styl a best practices definované v aplikaci:
   - `Europe/Prague` everywhere
   - žádný `<input type="date">`
   - reuse existujících komponent a helperů
   - minimální zbytečné refaktory mimo scope
6. Implementuj změny end-to-end včetně DB, API, UI, rolí, auditu a dokumentace.
7. Na konci:
   - napiš stručné shrnutí změn,
   - vypiš ověřené scénáře a co jsi testoval,
   - vypiš případná rizika nebo otevřené body,
   - aktualizuj `CLAUDE.md` a `PLAN.md`, a pokud je to potřeba, i relevantní části `DOKUMENTACE.md`.

Implementuj přesně podle `@SPECIFIKACE_DALSI_VLNY_ZMEN.md`.
