# OPS: Automatické zálohy

Denní automatická záloha produkce (DB `igvyroba` + přílohy rezervací + konfigurace).
Vzniklo z auditu před ostrým provozem (29. 7. 2026, nálezy OPS-01/OPS-02): do té doby
existoval jen ruční `mysqldump` před deployem — mezi deployi žádná záloha, přílohy
nezálohovalo vůbec nic.

## Co se zálohuje a kam

Vše do `/var/backups/planovanivyroby/` na produkčním serveru (192.168.10.210):

| Co | Kam | Jak | Retence |
| --- | --- | --- | --- |
| DB `igvyroba` | `db/igvyroba_<STAMP>.sql.gz` | `mysqldump --single-transaction` (bez zámků, app běží dál) + verifikace | 14 dní |
| Přílohy rezervací | `attachments/<STAMP>/` | `rsync --link-dest` — denní snapshoty, nezměněné soubory jen hardlink | 14 dní |
| `.env` + `ecosystem.config.cjs` | `config/` | kopie (env s mode 600) | 90 dní |
| Stav posledního běhu | `last_backup_status` | `OK …` / `FAIL <důvod>` — čte ho SSH banner | — |

Každý dump se ověřuje (gzip integrita, minimální velikost, `CREATE TABLE Block`,
patička `Dump completed`) — vadný dump = `FAIL` ve statusu, ne tichá „záloha".

## Instalace na server (jednorázově)

Po `git pull` v `/var/www/planovanivyroby`:

```bash
sudo install -m 700 scripts/ops/planovani-backup.sh /usr/local/bin/planovani-backup.sh
sudo install -m 755 scripts/ops/planovani-status-banner.sh /etc/profile.d/planovani-status.sh
sudo mkdir -p /var/backups/planovanivyroby

# root crontab (mysqldump jede přes auth_socket → žádné heslo):
sudo crontab -e
# přidat řádek:
# 45 1 * * * /usr/local/bin/planovani-backup.sh >> /var/log/planovani-backup.log 2>&1
```

První ruční běh + kontrola:

```bash
sudo /usr/local/bin/planovani-backup.sh
cat /var/backups/planovanivyroby/last_backup_status   # musí začínat "OK"
ls -lh /var/backups/planovanivyroby/db/
```

Po přihlášení přes SSH se stav poslední zálohy vypisuje automaticky (banner).
Po aktualizaci skriptu v repu zopakovat `sudo install …` (cron spouští kopii
v `/usr/local/bin`, ne working tree).

## Obnova (restore)

Restore z denního dumpu — **před obnovou vždy zastavit aplikaci**:

```bash
pm2 stop planovanivyroby
zcat /var/backups/planovanivyroby/db/igvyroba_<STAMP>.sql.gz | sudo mysql igvyroba
pm2 start planovanivyroby
```

Přílohy: `rsync -a /var/backups/planovanivyroby/attachments/<STAMP>/ /var/www/planovanivyroby/data/reservation-attachments/`

## Čtvrtletní test obnovy (záloha bez otestovaného restore není záloha)

```bash
sudo mysql -e "CREATE DATABASE igvyroba_restore_test"
zcat /var/backups/planovanivyroby/db/igvyroba_<POSLEDNI>.sql.gz | sudo mysql igvyroba_restore_test
sudo mysql igvyroba_restore_test -e "SELECT COUNT(*) FROM Block"   # porovnat s produkcí
sudo mysql -e "DROP DATABASE igvyroba_restore_test"
```

## Zásady

- **NIKDY nespouštět `git clean -x` / `git clean -fdx` v produkční složce** —
  přílohy žijí v gitignored `data/reservation-attachments/` uvnitř repa a git clean
  by je nenávratně smazal. (Dtto lokálně v dev, pokud tam máš testovací přílohy.)
- `npm run prisma:seed` je destruktivní a na produkci odmítne běžet (chybí
  `ALLOW_SEED=1`, viz `prisma/seed.ts`). Tuhle pojistku neobcházet.
- Ruční dump před deployem (`DEPLOY_WORKFLOW.md` krok 4b) zůstává v platnosti —
  denní záloha ho nenahrazuje, kryje období mezi deployi.

## Budoucí kroky (zatím vědomě neřešeno)

- **Off-site kopie** záloh mimo server (NAS přes Michala / pull z Vojtova Macu) —
  dnes zálohy leží na stejném stroji jako DB; úmrtí serveru je nekrytý scénář.
  Ve skriptu je připravený zakomentovaný blok (krok 6). Rozhodnuto 29. 7. 2026: odloženo.
- Health-check skript (à 15 min) + e-mail alerting — plánovaná Fáze 3 auditu.
- Denní CSV export klíčových tabulek pro Excel — plánovaná Fáze 3 auditu.
