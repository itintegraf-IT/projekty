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

Na serveru:

```bash
cd /var/www/planovanivyroby
git status
git branch -vv
git remote -v
```

Očekávaný stav:

```text
On branch michal
Your branch is up to date with 'origin/michal'.
nothing to commit, working tree clean
```

Pokud pracovní strom není čistý, zastavit se a zjistit proč. Nepoužívat
`git reset --hard` bez jasného důvodu a zálohy.

## 5. Dry-run deploye

Deploy script je na serveru ve větvi `michal`:

```bash
cd /var/www/planovanivyroby
ls -la scripts/deploy.sh
DRY_RUN=1 ./scripts/deploy.sh
```

Pokud shell vrátí `Permission denied`, nastavit executable bit:

```bash
chmod +x scripts/deploy.sh
DRY_RUN=1 ./scripts/deploy.sh
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

Na serveru:

```bash
cd /var/www/planovanivyroby
./scripts/deploy.sh
```

Explicitní varianta, když chceme mít jistotu větve:

```bash
GIT_BRANCH=michal ./scripts/deploy.sh
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

## 7. DB kontroly po změnách času nebo odstávek

Po změnách, které se týkají času, naplánování nebo odstávek, ověřit:

```sql
SHOW COLUMNS FROM CompanyDay;
SELECT id, label, startDate, endDate, machine
FROM CompanyDay
ORDER BY id DESC
LIMIT 5;
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

## Automatizace do budoucna

Aktuální `scripts/deploy.sh` je dobrý základ a už automatizuje serverovou část:
pull, instalaci, Prisma validate/generate/migrate, bootstrap, build a PM2 reload.

Co bych automatizoval později:

- Přidat lokální helper pro merge `Vojta -> michal`, který před pushem spustí testy a build.
- Přidat kontrolu, že se deployuje jen z větve `michal` malým písmenem.
- Přidat rychlou DB health kontrolu pro `CompanyDay.startDate/endDate = datetime(3)`.

Co bych zatím nedělal:

- Nepřepínal bych serverový deploy script na větev `Vojta`.
- Nedával bych automatický merge z `Vojta` do `michal` přímo na server.
- Neautomatizoval bych opravy produkční DB bez ručního potvrzení.
