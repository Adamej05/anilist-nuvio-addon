/** Small Czech page: type an AniList user name, get the manifest URL. */
export function configurePage(origin: string, defaultUser: string | undefined): string {
  const user = escapeHtml(defaultUser ?? "");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AniList Sezóny</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --text:#1b1f24; --muted:#5b6470; --accent:#2f6fde; --border:#dde1e6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111418; --card:#1a1f25; --text:#e8ebef; --muted:#9aa4b0; --accent:#6ea0ff; --border:#2c333b; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:560px; margin:48px auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; }
  p { color:var(--muted); margin:0 0 20px; }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font:inherit; }
  output { display:block; margin-top:16px; padding:10px 12px; border-radius:8px; background:var(--bg); word-break:break-all; font-family:ui-monospace, monospace; font-size:14px; }
  .row { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  button, a.btn { padding:10px 14px; border-radius:8px; border:0; background:var(--accent); color:#fff; font:inherit; cursor:pointer; text-decoration:none; }
  small { display:block; margin-top:16px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>AniList Sezóny</h1>
    <p>Katalogy anime podle roku a sezóny a tvoje seznamy z AniListu pro Nuvio a Stremio.</p>
    <label for="user">Uživatelské jméno na AniListu</label>
    <input id="user" value="${user}" placeholder="např. Achnatos" autocomplete="off">
    <output id="url"></output>
    <div class="row">
      <button id="copy" type="button">Kopírovat URL</button>
      <a class="btn" id="install" href="#">Otevřít ve Stremiu</a>
    </div>
    <small>Prázdné jméno = jen sezónní katalogy bez seznamů. Profil musí být veřejný.</small>
  </div>
</main>
<script>
  const base = ${JSON.stringify(origin)}; // URL.origin is percent-encoded, so no "<" can appear
  const input = document.getElementById("user");
  const out = document.getElementById("url");
  const install = document.getElementById("install");
  function update() {
    const name = input.value.trim();
    const url = name ? base + "/u/" + encodeURIComponent(name) + "/manifest.json" : base + "/manifest.json";
    out.textContent = url;
    install.href = url.replace(/^https?:/, "stremio:");
  }
  input.addEventListener("input", update);
  document.getElementById("copy").addEventListener("click", () => navigator.clipboard.writeText(out.textContent));
  update();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
