-- AlterTable
-- tiskoveArchy/serie drží JSON pole vybraných labelů; VARCHAR(191) by přeteklo
-- při výběru mnoha sérií/archů (P2000). Rozšíření na TEXT.
ALTER TABLE `Block` MODIFY `tiskoveArchy` TEXT NULL,
    MODIFY `serie` TEXT NULL;
