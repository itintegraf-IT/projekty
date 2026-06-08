-- Composite index pro overlap dotazy (machine + časový rozsah).
-- checkBlockOverlap, assertNoOverlapForBlocks i resolveChainPushFromDb filtrují
-- přesně na (machine, startTime, endTime) — bez indexu skenují tabulku Block.
-- Pozn.: index NENÍ FK, takže se ho netýká produkční INT UNSIGNED gotcha na Block.id.
CREATE INDEX `Block_machine_time_idx` ON `Block`(`machine`, `startTime`, `endTime`);
