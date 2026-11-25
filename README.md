# AniList Sezóny: doplněk pro Nuvio a Stremio

Doplněk (addon) ve formátu Stremio addon protocol. Nabízí:

- **Anime: Nejpopulárnější** a **Anime: Nejlépe hodnocené**, oba s jedním filtrem
  „Vše / Zima (všechny roky) / … / Rok 2027 / Zima 2027 / … / Rok 1960 / Akce / … / Shounen / Seinen / …“.
  Za roky následují žánry (Akce, Romantika, Sport, …, Hentai) a demografie (Shounen, Shoujo, Seinen, Josei, Pro děti).
  Dospělé tituly (`isAdult`) jsou vyloučené všude kromě volby Hentai, která ukazuje jen je.
  Nuvio ukáže jen jeden rozbalovací seznam, takže se vybírá buď období, nebo žánr, kombinovat je nejde.
- **AniList: Sleduji, V plánu, Dokončeno, Pozastaveno, Zahozeno** a všechny **vlastní seznamy**
  (např. Duo, Solo) zvoleného uživatele AniListu (jen čtení, bez přihlášení), seřazené podle poslední změny,
- **ikonky na plakátech** ve všech katalozích, takže už na Home vidíš, co máš v seznamu:

  | Ikonka | Význam |
  |---|---|
  | zelená fajfka | Dokončeno |
  | oranžové hodiny | V plánu |
  | modré ▶ | Sleduji (i opakovaně) |
  | šedá pauza | Pozastaveno |
  | červený křížek | Zahozeno |
  | růžové dvě siluety | vlastní seznam Duo |

- **vlastní detail s epizodami**: popis, žánry, hodnocení, trailer, epizody s daty a názvy
  a na prvním řádku popisu, ve kterých tvých seznamech titul je.

Běží zdarma na Vercelu (Hobby), data bere z veřejného AniList GraphQL API.
Streamy pro epizody najde **Torrentio** (ID epizod jsou `kitsu:<id>:<epizoda>`).

## Jak to funguje

| Část | Řešení |
|---|---|
| ID seriálů | `alsz:<anilistId>`: vlastní prefix, detail dodá vždy tento addon (bez závislosti na pořadí doplňků) |
| ID filmů | `kitsu:<id>` (záložně IMDb), protože Nuvio u filmů pouští stream s ID položky |
| ID epizod | `kitsu:<id>:<epizoda>`, Torrentio je umí; bez Kitsu mapování `alsz:<id>:<epizoda>` (bez streamů) |
| Dospělé tituly | typ `anime`, epizody `anilist:<id>:<epizoda>`: formát, který umí zdrojový doplněk [Yomi](https://github.com/mralanbourne/Yomi) (streamy deklaruje jen pro typ `anime` a dospělé tituly přes Kitsu nenajde). Torrentio pro ně dotazované není |
| Mapování AniList → Kitsu/IMDb | [Fribb/anime-lists](https://github.com/Fribb/anime-lists), GitHub Action z něj denně vyrobí kompaktní `mapping.json` (~350 kB) ve větvi `data` |
| Detail a epizody | vlastní `/meta` z AniListu: počet epizod, data podle rozvrhu vysílání (chybějící dopočítá), názvy a náhledy z Crunchyroll dat AniListu |
| Ikonky | `/poster/<kódy>/<cesta obálky>` stáhne obálku z AniListu (JPEG i PNG), dokreslí ikonky a vrátí JPEG; CDN ji drží 30 dní |
| Tvoje seznamy | celá kolekce uživatele jedním dotazem (`MediaListCollection`), v paměti 15 min; z ní seznamy, vlastní seznamy i ikonky |
| Typ | katalog `anime`; položky `movie` (MOVIE, SPECIAL) nebo `series` (ostatní), stejně jako u AIOMetadata |
| Cache | Vercel CDN podle hlavičky `CDN-Cache-Control` (katalogy s ikonkami 15 min, manifest 1 h, plakáty 30 dní) a navíc v paměti funkce (stránky z AniListu 6 h, detail 6 h, kolekce 15 min, mapování 24 h) |
| Rate limit | AniList teď povoluje 30 požadavků za minutu (hlavička `X-RateLimit-Limit`). Při 429 addon počká podle `Retry-After` (max. 15 s) a zkusí to až 2× znovu |

**Proč ne Cloudflare Workers:** AniList blokuje všechny požadavky z Cloudflare Workers
(HTTP 403 „You have been manually blocked“, ověřeno 25. 11. 2026 z více lokalit, i s hlavičkou User-Agent).
Proto addon běží jako Node funkce na Vercelu.

**Proč kompaktní mapování:** plný Fribb soubor má 7,5 MB, kompaktní asi 350 kB, takže se rychleji stáhne
i zpracuje. Když kompaktní soubor chybí (třeba před prvním během Action), addon nouzově použije plný Fribb.

**Tituly bez mapování:** Fribb vynechává dospělé tituly úplně a úplně nové tituly může mít s pár dny
zpožděním. Pro ně se addon zeptá přímo [Kitsu API](https://kitsu.docs.apiary.io/) (podle AniList a MAL ID,
výsledek drží 24 h). Teprve když Kitsu titul nezná, mají epizody ID `alsz:…` a Nuvio pro ně zdroje nenabídne.
Pozor: Torrentio dospělé tituly skoro neindexuje, takže i s Kitsu ID často nic nenajde.

**Proč vlastní detail:** dřív detail dodával AIOMetadata a u některých `kitsu:` ID nic nevrátil,
takže se po kliknutí nic nezobrazilo. Seriály teď mají vlastní prefix `alsz:`, který nikdo jiný
neobsluhuje, a filmy s `kitsu:` addon obslouží taky (Nuvio zkouší doplňky v pořadí a při chybě jde na další).

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

`npm run dev` sestaví balíček a spustí lokální Node server na `http://127.0.0.1:8787` (port změníš proměnnou `PORT`):

- `http://127.0.0.1:8787/manifest.json`
- `http://127.0.0.1:8787/catalog/anime/al_popular/genre=Podzim%202026.json`
- `http://127.0.0.1:8787/catalog/anime/al_list_current.json`
- `http://127.0.0.1:8787/configure`: stránka, kde zadáš jméno a dostaneš manifest URL

Když ještě neexistuje větev `data` (nebo je repo soukromé), použije se nouzově plný Fribb.

## Nasazení na Vercel

1. **Repozitář na GitHubu:** `Adamej05/anilist-nuvio-addon`, větev `main`.
   Repo musí být **veřejné**: addon si mapování stahuje z `raw.githubusercontent.com`, a to u soukromého repa vrátí 404.
   Pokud repo pojmenuješ jinak, uprav `DEFAULT_MAPPING_URL` v `src/config.ts` (nebo proměnnou `MAPPING_URL`).
2. **Mapování:** Action *Build ID mapping* se spustí sama při pushi, který změní mapovací skript nebo workflow.
   Kdykoli jindy ji spustíš ručně přes *Actions → Build ID mapping → Run workflow*.
   Vznikne větev `data` se souborem `mapping.json`. Dál se obnovuje sama každý den ve 4:23 UTC.
3. **Vercel:** na [vercel.com](https://vercel.com) se přihlas přes GitHub, *Add New → Project* a importuj
   `Adamej05/anilist-nuvio-addon`. Nastavení se načte z `vercel.json` (Framework: Other,
   build `npm run build`, region `fra1`), nic dalšího se vyplňovat nemusí.
   Případně z příkazové řádky: `npx vercel login`, `npx vercel link`, `npx vercel deploy --prod`
   a napojení na GitHub `npx vercel git connect`.
4. Každý push do `main` pak nasadí novou verzi automaticky. Push do větve `data` vytvoří jen
   preview build, který nic nerozbije. Vypnout ho můžeš v *Settings → Git → Ignored Build Step*.

Build (`scripts/build.mjs`) zabalí addon pomocí esbuild do jedné Node funkce podle
[Build Output API](https://vercel.com/docs/build-output-api) (`.vercel/output`).

Výchozí hodnoty jsou v `src/config.ts`. Přepsat je můžeš proměnnými prostředí ve Vercelu
(*Project → Settings → Environment Variables*, pak redeploy):

| Proměnná | Výchozí | Význam |
|---|---|---|
| `ANILIST_USER` | `Achnatos` | uživatel pro seznamy; `-` = bez seznamů |
| `ENABLE_SPLIT_FILTERS` | `false` | `true` přidá testovací katalog se dvěma filtry |
| `MAPPING_URL` | raw URL větve `data` | kompaktní mapování |

Seznam žánrů je v `GENRES` v `src/filters.ts`: AniList žánry jdou přes `genre_in`,
demografie jsou na AniListu tagy a jdou přes `tag_in`.

Další konstanty jsou v `src/config.ts`: počet let se sezónami (`SEASON_YEARS_COUNT = 10`),
nejstarší rok (`MIN_YEAR = 1960`), formáty (`FORMATS`), doby cache, jazyk názvů.

## Manifest URL a přidání do Nuvia

Produkční adresa: **`https://anilist-nuvio-addon.vercel.app/manifest.json`**

- Výchozí uživatel: `https://<adresa>/manifest.json`
- Jiný účet: `https://<adresa>/u/<JmenoNaAniListu>/manifest.json`
- Nebo otevři `…/configure`, napiš jméno a zkopíruj URL.

V Nuviu: **Nastavení → Doplňky (Addons) → Přidat doplněk**, vlož manifest URL a potvrď.
Po aktualizaci addonu (nová verze manifestu) ho v Nuviu obnov nebo odeber a přidej znovu,
jinak si Nuvio drží starý manifest (bez detailu a vlastních seznamů).
Pokud se u filmů zobrazuje detail z jiného doplňku, posuň tento addon v pořadí nad AIOMetadata.
Katalogy najdeš na Home a v Discover (typ „anime“). Filtr je rozbalovací seznam „žánr“.

## Endpointy

| Cesta | Popis |
|---|---|
| `/manifest.json` | manifest, volby filtru se generují při každém požadavku (rok+1 až 1960) |
| `/catalog/anime/{id}.json` | katalog bez filtru |
| `/catalog/anime/{id}/genre=…&skip=….json` | katalog s filtrem a stránkováním |
| `/meta/{typ}/{id}.json` | detail s epizodami (typ `series` nebo `movie`, ID `alsz:…` nebo `kitsu:…`) |
| `/poster/{kódy}/{cesta obálky}` | plakát s ikonkami |
| `/u/{uživatel}/…` | totéž pro jiného uživatele AniListu |
| `/configure` | konfigurační stránka |

ID katalogů: `al_popular`, `al_top`, `al_list_current`, `al_list_planning`, `al_list_completed`,
`al_list_paused`, `al_list_dropped`, `al_custom_<název v base64url>` pro vlastní seznamy,
volitelně `al_popular_split`. Vlastní seznamy se načítají z AniListu při každém požadavku na manifest.

Které vlastní seznamy dostanou ikonku dvou siluet, určuje `DUO_LIST_NAMES` v `src/config.ts`
(výchozí `["duo"]`); `BOOKMARK_LIST_NAMES` přidá fialovou záložku dalším seznamům (výchozí žádné).

## Struktura

```
src/app.ts            router, CORS, hlavičky cache (Web Request → Response)
src/node.ts           Node adaptér (Vercel funkce i lokální server)
src/entry/            vstupní body: vercel.ts, dev-server.ts
src/manifest.ts       manifest a definice katalogů
src/filters.ts        volby filtru, převod na AniList proměnné, skip → stránka
src/anilist.ts        GraphQL dotazy, retry při 429
src/catalog.ts        obsluha katalogů
src/meta.ts           ID, náhledy, detail s epizodami
src/metaHandler.ts    obsluha /meta
src/badges.ts         kódy a kreslení ikonek (SDF, vyhlazené)
src/png.ts            malý PNG dekodér pro obálky
src/kitsu.ts          záložní dohledání Kitsu ID přes Kitsu API
src/mapping.ts        načtení mapování (paměť → GitHub → záloha Fribb)
src/mappingFormat.ts  formát mapování (sdílí ho i build skript)
src/cache.ts          cache v paměti (LRU s expirací)
src/configure.ts      konfigurační stránka
scripts/build.mjs     balíček pro Vercel a lokální server
scripts/build-mapping.ts
.github/workflows/    denní mapování, testy
test/                 testy (vitest)
```
