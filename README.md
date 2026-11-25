# AniList Sezóny: doplněk pro Nuvio a Stremio

Doplněk (addon) ve formátu Stremio addon protocol. Nabízí:

- **Anime: Nejpopulárnější** a **Anime: Nejlépe hodnocené**, oba s jedním filtrem
  „Vše / Zima (všechny roky) / … / Rok 2027 / Zima 2027 / … / Rok 1960“,
- **AniList: Sleduji, V plánu, Dokončeno, Pozastaveno, Zahozeno**, tedy seznamy
  zvoleného uživatele AniListu (jen čtení, bez přihlášení), seřazené podle poslední změny.

Běží zdarma na Cloudflare Workers, data bere z veřejného AniList GraphQL API.
Detail titulu s epizodami dodá **AIOMetadata**, streamy dodá **Torrentio**.

## Jak to funguje

| Část | Řešení |
|---|---|
| ID položek | `kitsu:<id>` (Torrentio i AIOMetadata), záložně `tt…` (IMDb), jinak `anilist:<id>` |
| Mapování AniList → Kitsu/IMDb | [Fribb/anime-lists](https://github.com/Fribb/anime-lists), GitHub Action z něj denně vyrobí kompaktní `mapping.json` (~350 kB) ve větvi `data` |
| Detail a epizody | náš addon meta neposkytuje, Nuvio se proto zeptá AIOMetadata (podporuje `kitsu:`, `tt`, `anilist:`) |
| Streamy | AIOMetadata vytvoří ID epizod `kitsu:<id>:<epizoda>` (nebo `tt…:S:E`) a Torrentio je umí |
| Typ | katalog `anime`; položky `movie` (MOVIE, SPECIAL) nebo `series` (ostatní), stejně jako u AIOMetadata |
| Cache | Cloudflare Cache API: sezónní katalogy 6 h, seznamy 15 min, mapování 24 h (plus v paměti) |
| Rate limit | AniList teď povoluje 30 požadavků za minutu (hlavička `X-RateLimit-Limit`). Při 429 addon počká podle `Retry-After` (max. 15 s) a zkusí to až 2× znovu |

**Proč kompaktní mapování:** plný Fribb soubor má 7,5 MB a jeho parsování trvá asi 30 ms CPU.
Free plán Workers dovoluje 10 ms CPU na požadavek. Kompaktní soubor se parsuje asi za 2 ms.
Když kompaktní soubor chybí (třeba před prvním během Action), addon použije plný Fribb jako
nouzovou zálohu a výsledek si uloží do cache. Na free plánu tahle záloha může selhat.

**Tituly bez mapování** (hlavně úplně nové) se nevynechávají. Dostanou ID `anilist:<id>`
a AIOMetadata je zkusí přeložit vlastním mapováním. Když to nezvládne, detail se neotevře.

### Co Nuvio umí z filtrů (extra)

Ověřeno ve zdrojácích NuvioMobile (větev `cmp-rewrite`) i NuvioTV:

- V Discover/Hledání Nuvio zobrazí **jen jeden rozbalovací seznam, a to z extra `genre`**.
  Kromě toho posílá `skip` pro stránkování. Ostatní extra (např. `rok`, `sezona`) nezobrazí ani neposílá.
- Katalogy s povinným extra (kromě `genre` s volbami) se na Home vůbec neukážou.
- NuvioTV stránkuje po 100 položkách, pokud katalog neuvede `pageSize`. Addon proto posílá `pageSize: 50`
  a `skip` zvládne s libovolnou hodnotou.

Varianta se dvěma filtry (`rok` + `sezona`) je za přepínačem `ENABLE_SPLIT_FILTERS`.
Podle zdrojáků Nuvio druhý filtr nezobrazí, ve Stremiu to může vypadat jinak.

## Lokální spuštění

Potřebuješ Node.js 22.18 nebo novější.

```powershell
npm install
```

```powershell
npm test
```

```powershell
npm run dev
```

Addon poběží na `http://127.0.0.1:8787`:

- `http://127.0.0.1:8787/manifest.json`
- `http://127.0.0.1:8787/catalog/anime/al_popular/genre=Podzim%202026.json`
- `http://127.0.0.1:8787/catalog/anime/al_list_current.json`
- `http://127.0.0.1:8787/configure`: stránka, kde zadáš jméno a dostaneš manifest URL

Když lokálně ještě neexistuje větev `data`, použije se nouzově plný Fribb (lokálně limit CPU neplatí).

## Nasazení na Cloudflare Workers přes GitHub

1. **Repozitář na GitHubu:** vytvoř `Adamej05/anilist-nuvio-addon` a pushni do něj tuhle složku (větev `main`).
   Pokud repo pojmenuješ jinak, uprav `MAPPING_URL` ve `wrangler.toml`.
   Repo musí být **veřejné**: Worker si mapování stahuje z `raw.githubusercontent.com`, a to u soukromého repa vrátí 404.
2. **Mapování:** Action *Build ID mapping* se spustí sama při pushi, který změní mapovací skript nebo workflow.
   Kdykoli jindy ji spustíš ručně přes *Actions → Build ID mapping → Run workflow*.
   Vznikne větev `data` se souborem `mapping.json`. Dál se obnovuje sama každý den ve 4:23 UTC.
3. **Cloudflare:** *Workers & Pages → Create → Import a repository*, vyber `Adamej05/anilist-nuvio-addon`.
   - Production branch: `main`
   - Build command: nech prázdné. Deploy command: `npx wrangler deploy` (výchozí).
   - V *Settings → Build → Branch control* **vypni „Builds for non-production branches“**, jinak
     Cloudflare zkouší sestavit i denní push do větve `data` (ten build selže, nic se nerozbije, jen to dělá šum).
4. Každý push do `main` pak nasadí novou verzi automaticky.

Nastavení se mění ve `wrangler.toml` v sekci `[vars]`. Proměnné z dashboardu by další deploy z Gitu přepsal.

| Proměnná | Výchozí | Význam |
|---|---|---|
| `ANILIST_USER` | `Achnatos` | uživatel pro seznamy; prázdné = bez seznamů |
| `ENABLE_SPLIT_FILTERS` | `false` | `true` přidá testovací katalog se dvěma filtry |
| `MAPPING_URL` | raw URL větve `data` | kompaktní mapování |

Další konstanty jsou v `src/config.ts`: počet let se sezónami (`SEASON_YEARS_COUNT = 10`),
nejstarší rok (`MIN_YEAR = 1960`), formáty (`FORMATS`), doby cache, jazyk názvů.

## Manifest URL a přidání do Nuvia

Po nasazení Cloudflare ukáže adresu ve tvaru `https://anilist-nuvio-addon.<tvuj-subdomain>.workers.dev`.

- Výchozí uživatel z `ANILIST_USER`: `https://anilist-nuvio-addon.<subdomain>.workers.dev/manifest.json`
- Jiný účet: `https://anilist-nuvio-addon.<subdomain>.workers.dev/u/<JmenoNaAniListu>/manifest.json`
- Nebo otevři `…/configure`, napiš jméno a zkopíruj URL.

V Nuviu: **Nastavení → Doplňky (Addons) → Přidat doplněk**, vlož manifest URL a potvrď.
Pořadí doplňků: AIOMetadata by měl zůstat nad doplňky, které umí meta pro `kitsu:`, aby detail dodával on.
Katalogy najdeš na Home a v Discover (typ „anime“). Filtr je rozbalovací seznam „žánr“.

## Endpointy

| Cesta | Popis |
|---|---|
| `/manifest.json` | manifest, volby filtru se generují při každém požadavku (rok+1 až 1960) |
| `/catalog/anime/{id}.json` | katalog bez filtru |
| `/catalog/anime/{id}/genre=…&skip=….json` | katalog s filtrem a stránkováním |
| `/u/{uživatel}/…` | totéž pro jiného uživatele AniListu |
| `/configure` | konfigurační stránka |

ID katalogů: `al_popular`, `al_top`, `al_list_current`, `al_list_planning`, `al_list_completed`,
`al_list_paused`, `al_list_dropped`, volitelně `al_popular_split`.

## Struktura

```
src/index.ts          router, CORS
src/manifest.ts       manifest a definice katalogů
src/filters.ts        volby filtru, převod na AniList proměnné, skip → stránka
src/anilist.ts        GraphQL dotazy, retry při 429
src/catalog.ts        obsluha katalogů
src/meta.ts           převod AniList média na Stremio položku
src/mapping.ts        načtení mapování (paměť → Cache API → GitHub → záloha Fribb)
src/mappingFormat.ts  formát mapování (sdílí ho i build skript)
src/cache.ts          pomocník pro Cache API
src/configure.ts      konfigurační stránka
scripts/build-mapping.ts
.github/workflows/    denní mapování, testy
test/                 testy (vitest)
```
