# Deploy Workflow: Vojta -> michal -> server

Tento dokument popisuje bezpečný postup nasazování na Linux server
`/var/www/planovanivyroby`.

## Základní pravidlo

- `Vojta` je pracovní větev pro vývoj.
- `michal` je deploy větev pro server.
- Server má tahat pouze z větve `michal` malým písmenem.
- Větev `Michal` s velkým `M` nepoužívat pro deploy, pokud není výslovně domluveno jinak.
- Na serveru neřešit merge konflikty. Merge z `Vojta` do `michal` dělat lokálně nebo přes GitHub.
- Na produkci nikdy nespouštět `npm run prisma:seed`, protože je destruktivní.

## Kdo co dělá

- Vývoj (kroky 1–3 tohoto dokumentu): Vojta, lokálně na vývojovém počítači.
- Server-side deploy (kroky 4–8): **Vojta** má SSH přístup na server a deploy provádí sám.
- Dříve dělal server-side část Michal; od 2026-04-20 to přebírá Vojta.

## 1. Lokální kontrola před commitem

Na vývojovém počítači:

```bash
git status --short --branch
node --test --import tsx src/lib/dateUtils.test.ts
npm run build
npm run lint
```

`npm run lint` může vracet warningy. Důležité je, aby nevracel error.

## 2. Commit a push do pracovní větve

```bash
git checkout Vojta
git status --short
git add <zmenene-soubory>
git commit -m "Strucny popis zmeny"
git push origin Vojta
```

Před pushem má být jasné, které soubory se commitují. Nepřidávat náhodně
build artefakty nebo lokální soubory.

## 3. Aktualizace deploy větve

Preferovaně lokálně nebo přes GitHub:

```bash
git fetch origin --prune
git checkout michal
git pull --ff-only origin michal
git merge Vojta
npm run build
git push origin michal
```

Pokud vznikne merge konflikt, řešit ho mimo server. Po vyřešení znovu spustit
build a teprve potom pushnout `michal`.

Kontrola, že `michal` obsahuje vše z `Vojta`:

```bash
git fetch origin --prune
git merge-base --is-ancestor origin/Vojta origin/michal
git rev-list --left-right --count origin/Vojta...origin/michal
```

Správný výsledek:

```text
0    <nejake-cislo>
```

První číslo `0` znamená, že `origin/michal` nechybí žádný commit z
`origin/Vojta`.

## 4. Kontrola serveru před deployem

### Připojení na server

- SSH host: `192.168.10.210` (firemní síť)
- Uživatel: `administrator`
- Klient: PuTTY (Windows) nebo `ssh administrator@192.168.10.210` (macOS/Linux)
- Produkční složka: `/var/www/planovanivyroby`
- Heslo je mimo git — viz `~/Desktop/Vojta_KB/deploy-credentials.md`.

### Přístup do MySQL na serveru

Produkční databáze se jmenuje **`igvyroba`** (malými písmeny, ne `IGvyroba`).

MySQL `root` na Ubuntu serveru používá plugin **`auth_socket`** — připojení
přes heslo (`mysql -u root -p`) skončí chybou `1698 Access denied`. Místo
toho používej `sudo`, který se připojí přes unix socket:

```bash
sudo mysql igvyroba
sudo mysqldump igvyroba > dump.sql
```

`sudo` se zeptá na heslo uživatele `administrator`, ne na MySQL heslo.

### Kontrola git stavu

Na serveru:

```bash
cd /var/www/planovanivyroby
git status
git branch -vv
git fetch origin --prune
git log --oneline origin/michal -5
```

Očekávaný stav:

```text
On branch michal
Your branch is up to date with 'origin/michal'.
nothing to commit, working tree clean
```

`git log origin/michal -5` musí nahoře ukázat ten samý commit, který jsme
před chvílí pushli z lokálu (krok 3). Pokud ne, něco se nepushlo.

Pokud pracovní strom není čistý, zastavit se a zjistit proč. Nepoužívat
`git reset --hard` bez jasného důvodu a zálohy.

## 4b. Záloha DB a PRE-deploy snapshot (POVINNÉ)

**Žádný deploy bez tohoto kroku.** Tohle je tvoje pojistka proti ztrátě
dat — bez ověřené zálohy a snapshotu nelze prokázat, že se nic neposunulo.

### 4b.1 mysqldump záloha

```bash
mkdir -p ~/backups
sudo mysqldump --single-transaction --triggers --routines --add-drop-table \
  igvyroba > ~/backups/igvyroba_pre_deploy_$(date +%Y%m%d_%H%M%S).sql

# Ověření, že dump je validní
ls -lh ~/backups/igvyroba_pre_deploy_*.sql | tail -1
grep -c "CREATE TABLE \`Block\`" ~/backups/igvyroba_pre_deploy_*.sql | tail -1
wc -l ~/backups/igvyroba_pre_deploy_*.sql | tail -1
```

Musí platit:

- soubor má jednotky/desítky MB (nesmí být 0 bytes)
- `grep -c "CREATE TABLE \`Block\`"` vrátí **1**
- `wc -l` jsou tisíce řádků

### 4b.2 PRE-deploy snapshot dat

Klíčový krok — bez tohoto snapshotu nemůžeme po deployi prokázat, že se nic
v datech neposunulo. Hodnotu `sum_secs` ber jako otisk: součet trvání
všech bloků v sekundách. Pokud se cokoli posune nebo zmizí, číslo se změní.

```bash
sudo mysql igvyroba -e "
SELECT
  COUNT(*) AS total_blocks,
  COUNT(DISTINCT machine) AS machines,
  MIN(startTime) AS earliest,
  MAX(startTime) AS latest,
  COUNT(DISTINCT splitGroupId) AS split_groups,
  COUNT(CASE WHEN reservationId IS NOT NULL THEN 1 END) AS reserved,
  SUM(UNIX_TIMESTAMP(endTime) - UNIX_TIMESTAMP(startTime)) AS sum_secs
FROM Block;

SELECT machine, COUNT(*) AS pocet FROM Block GROUP BY machine;
SELECT type, COUNT(*) AS pocet FROM Block GROUP BY type ORDER BY pocet DESC;

SELECT id, machine, startTime, endTime, type, blockVariant, splitGroupId
FROM Block ORDER BY id DESC LIMIT 10;
" | tee ~/backups/snapshot_PRE_$(date +%Y%m%d_%H%M%S).txt
```

Snapshot se uloží do `~/backups/snapshot_PRE_*.txt`. Hodnoty si zapamatuj
(zejména `total_blocks`, `sum_secs`, rozpad podle stroje a typu).

### 4b.3 Rollback plán

Pokud cokoli v krocích 5–7 selže, restore z dumpu:

```bash
sudo mysql igvyroba < ~/backups/igvyroba_pre_deploy_<TIMESTAMP>.sql
```

Před restorem **zastav aplikaci** (`pm2 stop ecosystem.config.cjs`), aby
nepsala do DB během importu.

## 5. Dry-run deploye

Deploy script je na serveru ve větvi `michal`.

**Gotcha — executable bit:** `deploy.sh` ve své pre-check fázi spustí
`git checkout scripts/deploy.sh`, aby zahodil případné lokální změny
(typicky CRLF→LF). Tím ale **smaže i náš `chmod +x`**. Proto se může stát,
že po dry-runu opět vrátí `Permission denied`. Řešení — chmod a spuštění
spojit do jednoho příkazu přes `&&`:

```bash
cd /var/www/planovanivyroby
ls -la scripts/deploy.sh
chmod +x scripts/deploy.sh && DRY_RUN=1 ./scripts/deploy.sh
```

Dry-run nesmí nic měnit. Měl by vypsat přibližně:

```text
git fetch origin michal
git checkout michal
git pull --ff-only origin michal
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run prisma:bootstrap
npm run build
pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs
```

## 6. Ostrý deploy

Na serveru (znovu chmod + spuštění na jednom řádku, kvůli gotcha výše):

```bash
cd /var/www/planovanivyroby
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
```

Explicitní varianta, když chceme mít jistotu větve:

```bash
chmod +x scripts/deploy.sh && GIT_BRANCH=michal ./scripts/deploy.sh
```

Za úspěch se považuje:

```text
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run prisma:bootstrap
npm run build
PM2 reload
Deploy dokončen.
```

Poznámky:

- `npm ci` může vypsat vulnerability warningy. Ty samy o sobě neznamenají
  neúspěšný deploy.
- Next může vypsat warning k `middleware` -> `proxy`. Není to blokující.
- `prisma:bootstrap` je bezpečný doplňovací bootstrap. `prisma:seed` nepoužívat
  na produkci.

## 7. POST-deploy ověření dat (POVINNÉ)

**Bez tohoto kroku deploy NEDOKONČUJEME.** Bez porovnání PRE a POST snapshotu
nemáme jak prokázat, že se v produkčních datech nic neposunulo. Tohle je
hlavní bezpečnostní pojistka.

### 7.1 POST snapshot

```bash
sudo mysql igvyroba -e "
SELECT
  COUNT(*) AS total_blocks,
  COUNT(DISTINCT machine) AS machines,
  MIN(startTime) AS earliest,
  MAX(startTime) AS latest,
  COUNT(DISTINCT splitGroupId) AS split_groups,
  COUNT(CASE WHEN reservationId IS NOT NULL THEN 1 END) AS reserved,
  SUM(UNIX_TIMESTAMP(endTime) - UNIX_TIMESTAMP(startTime)) AS sum_secs
FROM Block;

SELECT machine, COUNT(*) AS pocet FROM Block GROUP BY machine;
SELECT type, COUNT(*) AS pocet FROM Block GROUP BY type ORDER BY pocet DESC;

SELECT id, machine, startTime, endTime, type, blockVariant, splitGroupId
FROM Block ORDER BY id DESC LIMIT 10;
" | tee ~/backups/snapshot_POST_$(date +%Y%m%d_%H%M%S).txt
```

### 7.2 Porovnání PRE vs POST

Otevři oba snapshot soubory a porovnej. **Všechny hodnoty musí sedět 1:1.**
Klíčové metriky:

| Metrika | Význam |
|---|---|
| `total_blocks` | Celkový počet bloků — pokud klesl, něco zmizelo |
| **`sum_secs`** | **Součet trvání všech bloků v sekundách — časový otisk** |
| `earliest` / `latest` | Krajní časy — pokud se posunuly, něco se přeplánovalo |
| Rozpad podle stroje | XL_105 / XL_106 počty |
| Rozpad podle typu | ZAKAZKA / REZERVACE / UDRZBA počty |
| Top 10 IDs | Posledních 10 bloků se stejnými časy a stroji |

**`sum_secs` je nejcitlivější** — pokud se posunul i jeden blok o pár vteřin,
součet se změní. Pokud se neshoduje, **okamžitě rollback z dumpu** (krok 4b.3).

### 7.3 Tabulka `Block` obsahuje VŠECHNY typy bloků

Tabulka `Block` není jen zakázky. Obsahuje:

- `ZAKAZKA` — skutečné tisky
- `REZERVACE` — rezervace ze `/rezervace`
- `UDRZBA` — údržba stroje
- `MYTI`, `PRESTAVBA` — provozní bloky

Při verifikaci kontrolujeme rozpad **podle typu zvlášť**, ne jen celkový počet.

### 7.4 Specifické kontroly podle obsahu deploye

#### Po Prisma migraci
Pokud deploy obsahoval Prisma migraci, ověř, že nový sloupec/index existuje:

```bash
sudo mysql igvyroba -e "SHOW COLUMNS FROM Block LIKE 'nazev_sloupce';"
sudo mysql igvyroba -e "SELECT version_id, name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"
```

#### Po změnách v CompanyDay nebo času
Pokud deploy mění logiku odstávek nebo časů, ověř datetime přesnost:

```sql
SHOW COLUMNS FROM CompanyDay;
SELECT id, label, startDate, endDate, machine FROM CompanyDay ORDER BY id DESC LIMIT 5;
```

Správné schéma pro odstávky:

```text
startDate  datetime(3)
endDate    datetime(3)
machine    varchar(...) NULL
```

Pokud `startDate` nebo `endDate` jsou `date`, databáze zahazuje čas a odstávky
se budou ukládat nebo zobrazovat špatně.

Pro celodenní odstávku v Praze v letním čase, například `2026-04-09 00:00-23:59`,
je v DB správně UTC hodnota přibližně:

```text
startDate  2026-04-08 22:00:00.000
endDate    2026-04-09 21:59:00.000
```

## 8. Ruční smoke test po deployi

Po deployi v aplikaci ověřit:

- Přesun nebo resize bloku přes `00:00-01:00` na `XL_106` v pracovní den projde.
- `XL_105` v noci zůstává blokovaný podle pracovní doby.
- `XL_106` v neděli před `22:00` zůstává blokovaný.
- Nově vytvořená odstávka se uloží s časem a vykreslí na timeline.
- Testovací odstávky po ověření smazat.

## Shrnutí — kontrolní checklist před každým deployem

1. ☐ Lokálně: `npm run build`, `npm run lint`, všechny testy zelené
2. ☐ Při změnách v API/schema/planneru: subagent audit diffu `origin/michal..origin/Vojta` na rizika ztráty/posunu dat
3. ☐ Merge `Vojta → michal` lokálně (fast-forward), push origin michal
4. ☐ SSH na server, git status čistý, fetch + `git log origin/michal -5` ukazuje nový HEAD
5. ☐ **`mysqldump` záloha** s ověřením (velikost, `CREATE TABLE Block`, řádky)
6. ☐ **PRE snapshot** uložený do `~/backups/snapshot_PRE_*.txt`
7. ☐ Dry-run `DRY_RUN=1 ./scripts/deploy.sh` projde čistě
8. ☐ Ostrý `chmod +x scripts/deploy.sh && ./scripts/deploy.sh`
9. ☐ **POST snapshot** a porovnání všech metrik 1:1 s PRE (zejména `sum_secs`)
10. ☐ Pokud Prisma migrace: ověř `SHOW COLUMNS` že nový sloupec existuje
11. ☐ UI smoke test v prohlížeči (drag, resize, edit, mazání)

## Provozní rozhodnutí: HTTP uvnitř VPN (30. 7. 2026)

Aplikace je dostupná **výhradně z firemní sítě / přes VPN**, nikdy z internetu.
Vědomé rozhodnutí (Vojta, 30. 7. 2026, uzavírá audit SEC-02): zůstáváme na HTTP
s `COOKIE_SECURE=false`. Přijaté riziko: session cookie jde po LAN nešifrovaně —
kdokoli uvnitř sítě/VPN ji teoreticky může odchytit. Zmírnění: přístup jen VPN,
zkrácení kioskové session (hardening fáze auditu). **Přehodnotit, pokud by se
aplikace někdy vystavovala mimo VPN** — pak HTTPS + `COOKIE_SECURE=true` + HSTS.

## Migrace tokenVersion — ověřit PŘED restartem aplikace

Fáze 4 auditu přidala sloupec `User.tokenVersion` (revokace sessions). Pokud
by se nasadil kód bez migrace, **login by přestal fungovat** (Prisma by žádala
neexistující sloupec → 500), zatímco stávající sessions by dál běžely — takže
by to vypadalo, že aplikace je zdravá. `scripts/deploy.sh` má pořadí správně
(migrate → build → reload), ale při ručním zásahu ověř:

```bash
sudo mysql igvyroba -e "SHOW COLUMNS FROM User LIKE 'tokenVersion'"   # musí vrátit řádek
```

Po nasazení otestuj přihlášení jedním účtem dřív, než odejdeš od terminálu.

## Nginx: hlavička s IP klienta (POVINNÉ)

Rate limity loginu a `LoginLog` berou IP z `X-Real-IP`, jinak z poslední hodnoty
`X-Forwarded-For`. Pokud nginx neposílá ani jedno, všichni uživatelé vypadají
jako jeden klient (`unknown`). V server bloku aplikace proto musí být:

```nginx
proxy_set_header X-Real-IP        $remote_addr;
proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
proxy_set_header Host             $host;
```

Ověření po deployi: neúspěšné přihlášení a pak v adminu (LoginLog) zkontrolovat,
že u záznamu je skutečná IP stanice, ne `unknown` nebo `127.0.0.1`.

## PM2 provozní hygiena (jednorázově na serveru)

Rotace logů — bez ní PM2 logy rostou donekonečna a plný disk shodí MySQL
i aplikaci (audit OPS-04):

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Start po rebootu serveru (audit OPS-06 — dosud nikde nezajištěno):

```bash
pm2 startup systemd   # vypíše sudo příkaz — spustit ho
pm2 save
systemctl is-enabled pm2-administrator   # musí vrátit "enabled"
```

Propsání změn `ecosystem.config.cjs` (např. `max_memory_restart`) do běžícího
procesu — obyčejný `pm2 reload` env/limity nepřečte. **Provádět mimo špičku**
(pár sekund výpadku + odpojení SSE všem přihlášeným):

```bash
pm2 delete planovanivyroby
ss -ltnp | grep 3020   # MUSÍ být prázdné — orphan next-server by držel port
pm2 start ecosystem.config.cjs && pm2 save
```

Gotchy:

- **NIKDY nenastavovat `instances > 1` / cluster mód** — rate-limiter loginů
  a SSE spojení jsou in-memory per proces (komentář v ecosystem.config.cjs).
- PM2 měří paměť jen npm wrapperu, ne next-server childu — skutečný memory
  limit dělá `NODE_OPTIONS --max-old-space-size` v ecosystem.config.cjs.
  Ověření na serveru: `pm2 ls` (mem ~50-80 MB) vs. `ps aux | grep next-server`.
- **Aplikační** chyby (logger) jdou na stdout → `-out.log`:
  `grep '"level":"error"' ~/.pm2/logs/planovanivyroby-out.log`.
  Pády procesu a framework chyby jdou na stderr → `-error.log`. Číst oba.

## Automatizace do budoucna

Aktuální `scripts/deploy.sh` je dobrý základ a už automatizuje serverovou část:
pull, instalaci, Prisma validate/generate/migrate, bootstrap, build a PM2 reload.

✅ VYŘEŠENO (29. 7. 2026): pravidelná denní záloha DB + příloh + konfigurace
běží z root cronu — skript `scripts/ops/planovani-backup.sh`, postup a restore
viz `docs/OPS_ZALOHY.md`. Ruční dump před deployem (krok 4b) zůstává v platnosti.

⚠️ PŘED upgradem na Next 17: přejmenovat `src/middleware.ts` → `proxy.ts`
(export `proxy`; codemod `npx @next/codemod@canary middleware-to-proxy`).
V Next 16 je to jen deprecation warning, ale pokud by Next 17 soubor přestal
číst, celá auth vrstva by tiše zmizela.

Co bych automatizoval později:

- Přidat lokální helper pro merge `Vojta -> michal`, který před pushem spustí testy a build.
- Přidat kontrolu, že se deployuje jen z větve `michal` malým písmenem.
- Přidat skript `scripts/snapshot.sh`, který vygeneruje PRE/POST snapshoty a uloží je do `~/backups/`.
- Přidat `scripts/verify-deploy.sh`, který automaticky porovná PRE a POST snapshot a vrátí non-zero, pokud se metriky neshodují.
- Opravit `deploy.sh`, aby ve fázi pre-check nezahazoval `chmod +x` na sobě samém (např. ignorovat změnu perm bitu, nebo aplikovat chmod za posledním checkoutem).

Co bych zatím nedělal:

- Nepřepínal bych serverový deploy script na větev `Vojta`.
- Nedával bych automatický merge z `Vojta` do `michal` přímo na server.
- Neautomatizoval bych opravy produkční DB bez ručního potvrzení.
