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
špičku** (deploy.sh dělá jen `pm2 reload`, který změny v bloku `env`
a memory limity NEPROPÍŠE — vynechání tohoto kroku nespustí žádný alarm!):

```bash
pm2 delete planovanivyroby
ss -ltnp | grep 3020        # MUSÍ být prázdné (orphan next-server)
pm2 start ecosystem.config.cjs && pm2 save
# Tvrdý strop haldy ZÁMĚRNĚ nastavený není (rozhodnuto při go/no-go auditu
# 3. 8. 2026 — nebyl podložen měřením). Následující příkaz proto NESMÍ nic vypsat:
ps -o args= -C node | grep max-old-space-size
# Místo stropu se sleduje skutečná spotřeba — změř ji ve špičce (střídání směn)
# a teprve podle naměřené hodnoty případně strop doplň s ~2× rezervou:
ps -o rss=,args= -C node | grep next-server
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

### Úklid revizí bloků (od etapy B1)

Tabulka `BlockRevision` je „černá skříňka" změn plánu — ke každé změně bloku
drží, jak řádek vypadal předtím a potom. Retence je **90 dní**; bez úklidu
by rostla donekonečna.

Přidat pátý řádek do téhož crontabu:

```
50 3 * * * /bin/sh -c 'export PATH=/home/administrator/.nvm/versions/node/v20.20.1/bin:$PATH; cd /var/www/planovanivyroby && npx tsx scripts/prune-revisions.ts' >> /var/log/planovani-backup.log 2>&1
```

> **POZOR — `npx` NENÍ v prostředí cronu dostupný.** Node je na serveru z **nvm**
> pod uživatelem `administrator` (`/home/administrator/.nvm/versions/node/<verze>/bin`),
> kdežto cron startuje s holým `PATH=/usr/bin:/bin`. Původní znění řádku
> (`/usr/bin/env npx tsx …`) proto **tiše nikdy neproběhlo** — ověřeno 9. 8. 2026,
> `/usr/bin/env: 'npx': No such file or directory`. Absolutní cesta k `npx` sama
> NESTAČÍ: je to skript se `#!/usr/bin/env node`, takže v `PATH` musí být i `node`.
> **Cesta obsahuje verzi Node** — po upgradu nvm ji v crontabu opravit, jinak úloha
> zase tiše přestane běžet.

**Před vložením do crontabu spusť skript dvakrát** — jednou normálně, jednou
v podmínkách cronu. Druhá zkouška je ta, která odhalí chybějící `PATH`; bez ní
se selhání pozná až podle toho, že tabulka nepřestává růst:

```bash
cd /var/www/planovanivyroby && npx tsx scripts/prune-revisions.ts

sudo sh -c 'PATH=/usr/bin:/bin; cd /var/www/planovanivyroby && /usr/bin/env npx tsx scripts/prune-revisions.ts'
```

Druhý příkaz MUSÍ projít stejně jako první. Když spadne, řádek do crontabu
v té podobě nepatří.

Po instalaci téhle páté úlohy vrací kontrola `sudo crontab -l | grep -c planovani`
hodnotu **5**, ne 4. Řádek s úklidem revizí jako jediný nespouští skript
z `/usr/local/bin` — jede přímo z pracovní kopie aplikace, protože potřebuje
`node_modules` a Prisma klienta.

> **Zjištěno 9. 8. 2026: v root crontabu na `srv-igweb` NEJSOU ani ty čtyři úlohy.**
> Je tam jediný řádek (`igweb-full-backup.sh`), takže denní záloha DB, health-check
> ani CSV export z Fáze 1 na serveru nikdy nainstalované nebyly. Než se přidá pátá
> úloha, je potřeba doinstalovat ty čtyři — a ověřit, jestli neběží pod jiným
> uživatelem: `crontab -l | grep planovani` (bez `sudo`).

Čas 3:50 je **po** noční záloze (1:45) a CSV exportu (2:20) — smazané revize
tak vždycky ještě jednou odejdou do zálohy, než z databáze zmizí. A je mimo
mřížku */15 ze stejného důvodu jako ostatní.

Skript maže **výhradně** z `BlockRevision` a **po celých skupinách** — půlka
kroku v tabulce je horší než žádná, protože rekonstrukce by pak tvrdila, že se
změnila jen část bloků. Retence se nastavuje jedinou konstantou
`REVISION_RETENTION_DAYS` ve skriptu.

Do logu píše jeden řádek s počtem smazaných řádků, počtem dávek, zbytkem
v tabulce a velikostí v MB — **velikost sleduj**: první měsíc provozu ověř,
že sedí odhad: **~470 bajtů na řádek** včetně čtyř indexů (ty tvoří asi třetinu
objemu), tedy řádově **15–40 MB za 90 dní** podle intenzity provozu. Starší
odhad „pod 25 MB" počítal jen s daty bez indexů a je podstřelený zhruba
dvojnásobně — když uvidíš víc, není to porucha.

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
# 1) Zastavit aplikaci POD JEJÍM UŽIVATELEM. `pm2 stop` spuštěný jako root mluví
#    s vlastním prázdným démonem, vypíše „Process name not found" a aplikace běží
#    dál — pak by importu psala do DB pod rukama.
sudo -u administrator -i pm2 stop planovanivyroby
ss -ltnp | grep 3020 || echo "aplikace stojí"          # nesmí nic vypsat

# 2) POJISTNÁ ZÁLOHA aktuálního stavu. Dump má --add-drop-table, takže import
#    nenávratně přepíše všechno, co v DB je. Bez tohohle kroku není cesta zpět,
#    když se ukáže, že se obnovoval špatný soubor.
sudo sh -c 'umask 077; mysqldump --single-transaction --routines --events igvyroba | gzip > /var/backups/planovanivyroby/db/PRE_RESTORE_$(date +%Y%m%d_%H%M%S).sql.gz'

# 3) Ověřit zdrojový soubor DŘÍV, než se ho dotkneme
sudo gzip -t /var/backups/planovanivyroby/db/igvyroba_<STAMP>.sql.gz
sudo zgrep -c 'CREATE TABLE `Block`' /var/backups/planovanivyroby/db/igvyroba_<STAMP>.sql.gz   # musí být 1

# 4) Vlastní obnova
sudo sh -c 'zcat /var/backups/planovanivyroby/db/igvyroba_<STAMP>.sql.gz | mysql igvyroba'

# 5) Dorovnat schéma. Dump je ze starší doby a přepsal i _prisma_migrations, takže
#    sloupce z novějších migrací (např. User.tokenVersion) v DB chybí. Kód je ale
#    nový → bez tohohle kroku se NIKDO nepřihlásí, a /api/health přitom hlásí OK.
cd /var/www/planovanivyroby && sudo -u administrator npx prisma migrate deploy
sudo mysql igvyroba -e "SHOW COLUMNS FROM User LIKE 'tokenVersion'"    # musí vrátit řádek

# 6) Start a ověření
sudo -u administrator -i pm2 start planovanivyroby
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3020/api/health   # 200
```

Po startu **vždy vyzkoušet přihlášení jedním účtem** — je to jediná kontrola,
která odhalí rozjeté schéma proti kódu.

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
