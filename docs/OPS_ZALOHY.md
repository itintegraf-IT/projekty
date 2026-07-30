# OPS: Automatické zálohy

Denní automatická záloha produkce (DB `igvyroba` + přílohy rezervací + konfigurace).
Vzniklo z auditu před ostrým provozem (29. 7. 2026, nálezy OPS-01/OPS-02): do té doby
existoval jen ruční `mysqldump` před deployem — mezi deployi žádná záloha, přílohy
nezálohovalo vůbec nic.

## Co se zálohuje a kam

Vše do `/var/backups/planovanivyroby/` na produkčním serveru (192.168.10.210):

| Co | Kam | Jak | Retence |
| --- | --- | --- | --- |
| DB `igvyroba` | `db/igvyroba_<STAMP>.sql.gz` | `mysqldump --single-transaction` (bez zámků, app běží dál) + verifikace | posledních 14 |
| Přílohy rezervací | `attachments/<STAMP>/` | `rsync --link-dest` — denní snapshoty, nezměněné soubory jen hardlink | posledních 14 |
| `.env` + `ecosystem.config.cjs` | `config/` | kopie (env s mode 600) | posledních 90 |
| Stav posledního běhu | `last_backup_status` | `OK …` / `FAIL <důvod>` — čte ho SSH banner | — |

Každý dump se ověřuje (gzip integrita, minimální velikost, `CREATE TABLE Block`,
patička `Dump completed`) a na finální jméno se přejmenuje až po verifikaci —
v `db/` nikdy neleží neověřené torzo. Vadný dump = `FAIL` ve statusu.

Retence je **podle počtu, ne podle stáří** (mtime-retence by v klidovém období
mazala i čerstvé snapshoty — rsync přenáší mtime zdroje; nález review 29. 7. 2026)
— poslední zálohy tedy přežijí, i kdyby nové přestaly vznikat. Zálohy nejsou
world-readable (`umask 077`, adresáře 700; dump obsahuje hashe hesel) a proti
souběhu cron × ruční běh drží `flock`.

## Instalace na server (jednorázově)

Po `git pull` v `/var/www/planovanivyroby`:

**Pořadí nasazení (důležité):** health-check cron instalovat až PO deployi
aplikace s `/api/health` (jinak každých 15 min falešný alarm „HTTP 404")
a po `pm2 startup` (kontroluje unit `pm2-administrator`). První noc po
instalaci se samy zahojí alarmy „záloha/CSV nikdy neproběhly".

**Ověření pm2 z cronu (jednorázově):** `sudo -n -u administrator -i pm2 jlist | head -c 100`
spuštěné jako root — musí vypsat JSON (`[{...`). Pokud ne (pm2 přes nvm apod.),
health-check to nahlásí jako „pm2 nedostupné z cronu" — primární kontrola
běhu přes systemd unit funguje i tak.

```bash
command -v curl  || sudo apt install curl    # závislost health-checku
command -v rsync || sudo apt install rsync   # závislost zálohy
command -v jq    || sudo apt install jq      # závislost health-checku
sudo install -m 700 scripts/ops/planovani-backup.sh      /usr/local/bin/planovani-backup.sh
sudo install -m 700 scripts/ops/planovani-healthcheck.sh /usr/local/bin/planovani-healthcheck.sh
sudo install -m 700 scripts/ops/planovani-csv-export.sh  /usr/local/bin/planovani-csv-export.sh
sudo install -m 755 scripts/ops/planovani-status-banner.sh /etc/profile.d/planovani-status.sh
sudo mkdir -p /var/backups/planovanivyroby

# root crontab (mysqldump jede přes auth_socket → žádné heslo):
sudo crontab -e
# přidat řádky:
# 45 1 * * *    /usr/local/bin/planovani-backup.sh      >> /var/log/planovani-backup.log 2>&1
# 15 2 * * *    /usr/local/bin/planovani-csv-export.sh  >> /var/log/planovani-backup.log 2>&1
# */15 * * * *  /usr/local/bin/planovani-healthcheck.sh >> /var/log/planovani-health.log 2>&1
# 0 7 * * *     /usr/local/bin/planovani-healthcheck.sh --report >> /var/log/planovani-health.log 2>&1
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

## Health-check (à 15 min + denní report v 7:00)

`planovani-healthcheck.sh` kontroluje: HTTP 200 z neautentizovaného
`/api/health` (endpoint dělá i `SELECT 1` do DB), PM2 proces online + detekci
crash-loopu (skok počtu restartů), běh MySQL, zaplnění disku `/` a `/var`
(limit 85 %), velikost PM2 logů (pojistka na rotaci) a **čerstvost zálohy**
(status `OK` mladší 26 h + existence čerstvého dumpu). Výsledek zapisuje do
`health_status` (čte ho SSH banner) a při problému vrací exit 1.

**E-mail alerty (volitelné):** skript posílá poštu jen pokud je nainstalovaný
`msmtp` — bez něj tiše funguje přes status soubor + banner. Aktivace: od
Michala SMTP účet → `/etc/msmtprc` (nastavit i `from`/`auto_from on`, jinak
server mail bez From hlavičky odmítne) → adresy v proměnné `MAIL_TO` ve
skriptu. Anti-spam: stejný typ problémů max 1 e-mail za hodinu; denní
`--report` posílá heartbeat „vše OK" — ticho pak spolehlivě znamená problém.

**Rotace vlastních logů** (`/var/log/planovani-*.log` by jinak rostly věčně) —
vytvořit `/etc/logrotate.d/planovani`:

```
/var/log/planovani-*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
```

## Denní CSV export (2:15)

`planovani-csv-export.sh` exportuje `Block`, `Reservation`,
`ReservationAttachment`, `User` (bez `passwordHash`) a `AuditLog` (poslední
měsíc) do `/var/backups/planovanivyroby/csv/<YYYYMMDD>/` — UTF-8 s BOM,
středníkový oddělovač, Excel CZ to otevře dvojklikem. Pojistka nezávislá na
Prismě i formátu dumpu. Retence: posledních 30 exportů.

## Budoucí kroky (zatím vědomě neřešeno)

- **Off-site kopie** záloh mimo server (NAS přes Michala / pull z Vojtova Macu) —
  dnes zálohy leží na stejném stroji jako DB; úmrtí serveru je nekrytý scénář.
  Ve skriptu je připravený zakomentovaný blok (krok 6). Rozhodnuto 29. 7. 2026: odloženo.
- E-mail alerting čeká na SMTP účet od Michala (viz Health-check výše).
