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

## Instalace na server — kompletní checklist (jednorázově, v tomto pořadí)

**Fáze 0 — prerekvizity** (SSH jako administrator):

```bash
node -v            # MUSÍ být >= 20.9 (požadavek next@16.2.12) — jinak STOP
sudo apt update && sudo apt install -y curl rsync jq
for b in flock timeout md5sum zgrep mysqldump mysql gzip; do command -v $b || echo "CHYBI: $b"; done
systemctl is-active mysql                                  # → active
sudo mysqldump --single-transaction igvyroba | head -c 200 # auth_socket funguje
grep -E 'PORT|ALLOW_SEED' /var/www/planovanivyroby/.env    # PORT nenastaven/3020; ALLOW_SEED NESMÍ existovat
df -h /var                                                 # volné místo na zálohy
```

**Fáze 1 — deploy aplikace** (podle `DEPLOY_WORKFLOW.md`, včetně dump + PRE
snapshot). Aplikace musí mít `/api/health` — bez něj neinstalovat health cron.
Hned po prvním deployi s novým `ecosystem.config.cjs` **jednorázově, mimo
špičku** (deploy.sh dělá jen `pm2 reload`, který NODE_OPTIONS/memory limity
NEPROPÍŠE — vynechání tohoto kroku nespustí žádný alarm!):

```bash
pm2 delete planovanivyroby
ss -ltnp | grep 3020        # MUSÍ být prázdné (orphan next-server)
pm2 start ecosystem.config.cjs && pm2 save
ps aux | grep next-server   # v procesu vidět --max-old-space-size=768
curl -s http://localhost:3020/api/health   # → {"status":"ok"}
```

**Fáze 2 — PM2 hygiena** (detaily v `DEPLOY_WORKFLOW.md`): `pm2 install
pm2-logrotate` + nastavení, `pm2 startup systemd` + `pm2 save`. Pak **blokující
test** — jako root: `sudo -n -u administrator -i pm2 jlist | head -c 100` musí
začínat `[`. Pokud ne (pm2 přes nvm), opravit PŘED instalací health cronu
(např. `sudo ln -s "$(sudo -u administrator -i which pm2)" /usr/local/bin/pm2`),
jinak zůstane trvalý falešný alarm à 15 minut.

**Fáze 3 — instalace skriptů:**

```bash
cd /var/www/planovanivyroby
sudo install -m 700 scripts/ops/planovani-backup.sh      /usr/local/bin/planovani-backup.sh
sudo install -m 700 scripts/ops/planovani-healthcheck.sh /usr/local/bin/planovani-healthcheck.sh
sudo install -m 700 scripts/ops/planovani-csv-export.sh  /usr/local/bin/planovani-csv-export.sh
sudo install -m 755 scripts/ops/planovani-status-banner.sh /etc/profile.d/planovani-status.sh
sudo mkdir -p /var/backups/planovanivyroby && sudo chmod 711 /var/backups/planovanivyroby
```

Plus logrotate snippet (sekce Health-check níže) a jeho dry-run:
`sudo logrotate -d /etc/logrotate.d/planovani`.

**Fáze 4 — první ruční běh VŠECH TŘÍ skriptů (ještě PŘED crontabem** — ověří
funkčnost a první noc pak proběhne bez jediného falešného alarmu**):**

```bash
sudo /usr/local/bin/planovani-backup.sh        # → „Záloha OK"
sudo /usr/local/bin/planovani-csv-export.sh    # → „CSV export OK: … (5 souborů)"
sudo /usr/local/bin/planovani-healthcheck.sh   # → „OK <timestamp>" — pokud PROBLEM, opravit TEĎ
cat  /var/backups/planovanivyroby/last_backup_status
sudo ls -lh /var/backups/planovanivyroby/db/
```

Nová SSH session → banner musí být zelený (Záloha OK + Health OK).

**Fáze 5 — cron** (root; POZOR — vkládat řádky BEZ `#` na začátku!):

```
45 1 * * *   /usr/local/bin/planovani-backup.sh      >> /var/log/planovani-backup.log 2>&1
20 2 * * *   /usr/local/bin/planovani-csv-export.sh  >> /var/log/planovani-backup.log 2>&1
*/15 * * * * /usr/local/bin/planovani-healthcheck.sh >> /var/log/planovani-health.log 2>&1
5 7 * * *    /usr/local/bin/planovani-healthcheck.sh --report >> /var/log/planovani-health.log 2>&1
```

Report je v 7:05 a CSV ve 2:20 **záměrně mimo mřížku */15** — čas dělitelný
15 by kolidoval s pravidelnou kontrolou (flock, resp. freshness race).
Ověření: `sudo crontab -l | grep -c planovani` → 4 (žádný nesmí začínat `#`).

**Fáze 6 — kontrola D+1 ráno:** `sudo tail -20 /var/log/planovani-backup.log`
(noční záloha OK + CSV OK), banner zelený, `sudo tail /var/log/planovani-health.log`
bez PROBLEM.

Po aktualizaci skriptu v repu zopakovat `sudo install …` (cron spouští kopii
v `/usr/local/bin`, ne working tree).

## Obnova (restore)

Restore z denního dumpu — **před obnovou vždy zastavit aplikaci**:

Zálohy jsou root-only (`umask 077`) — **všechny čtecí příkazy potřebují sudo**,
jinak selžou na Permission denied (a to typicky uprostřed havárie):

```bash
pm2 stop planovanivyroby
sudo sh -c 'zcat /var/backups/planovanivyroby/db/igvyroba_<STAMP>.sql.gz | mysql igvyroba'
pm2 start planovanivyroby
```

Přílohy (po obnově zkontrolovat vlastnictví, ať je aplikace přečte):

```bash
sudo rsync -a /var/backups/planovanivyroby/attachments/<STAMP>/ /var/www/planovanivyroby/data/reservation-attachments/
sudo chown -R administrator: /var/www/planovanivyroby/data/reservation-attachments/
```

## Čtvrtletní test obnovy (záloha bez otestovaného restore není záloha)

```bash
sudo mysql -e "CREATE DATABASE igvyroba_restore_test"
sudo sh -c 'zcat /var/backups/planovanivyroby/db/igvyroba_<POSLEDNI>.sql.gz | mysql igvyroba_restore_test'
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

## Health-check (à 15 min + denní report v 7:05)

`planovani-healthcheck.sh` kontroluje: HTTP 200 z neautentizovaného
`/api/health` (endpoint dělá i `SELECT 1` do DB), **systemd unit
`pm2-administrator`**, PM2 proces online + detekci crash-loopu (skok počtu
restartů), běh MySQL, zaplnění disku `/` a `/var` (limit 85 %, dedup mountů),
velikost PM2 logů (pojistka na rotaci), **čerstvost zálohy** (status `OK`
mladší 26 h + existence čerstvého dumpu) a **čerstvost CSV exportu** (adresář
mladší 26 h). Výsledek zapisuje do `health_status` (čte ho SSH banner) a při
problému vrací exit 1.

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

## Denní CSV export (2:20)

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
