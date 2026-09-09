# AICON

Non-custodial swap router on Robinhood Chain. Static site, no build step required.

- Live site: `index.html`
- Docs: `docs.html`
- App: `app.html`
- GitHub: https://github.com/aiconhood
- Twitter/X: https://x.com/aicon_hood

## Structure

```
aicon-site/
├── index.html        landing page
├── docs.html          documentation
├── app.html           wallet connect / coming-soon swap UI
├── vercel.json        clean URLs + redirects for Vercel
├── assets/
│   ├── logo.svg        original brand logo
│   ├── style.css       shared design system (colors, type, layout)
│   ├── app.css         app.html-specific styles
│   └── app.js          Reown AppKit wallet connect wiring
└── README.md
```

## `app.html` — wallet connect

`app.html` is the "Launch App" destination. It connects wallets on Robinhood
Chain (chain ID 4663) using [Reown AppKit](https://docs.reown.com/appkit),
loaded straight from an ESM CDN (`esm.sh`) — no npm install or bundler, in
keeping with the rest of this static site.

**Swap execution is intentionally not wired up.** AICON's router contract
isn't deployed or audited yet (see `docs.html#security`), so the swap panel
on `app.html` is a disabled preview — connecting a wallet there requests no
signature and moves no funds. Wire up the real swap flow only once a router
contract exists, following the `swapExactTokensForTokens` interface
documented in `docs.html#contracts`.

Before wallet connect will actually work, you need to:
1. Create a free project at [dashboard.reown.com](https://dashboard.reown.com).
2. Add this site's domain (and `localhost` for local testing) to that
   project's allowed origins.
3. Open `assets/app.js` and replace `YOUR_REOWN_PROJECT_ID` with your real
   Project ID.

Until a real Project ID is set, the page shows an on-page notice instead of
silently failing.

## Deploy

This is a plain static site (no build step, no framework), so any static host works.

### Vercel
1. Push this folder to a GitHub repo (e.g. `aiconhood/aicon-site`).
2. Go to vercel.com → New Project → import the repo.
3. Framework preset: "Other" / "Static". No build command needed, output directory: `.`
4. Deploy.

`vercel.json` in this folder turns on clean URLs and redirects the old
`.html` paths, so the live site resolves as `/`, `/docs`, `/app` instead of
`/index.html`, `/docs.html`, `/app.html`. Internal links across all three
pages already point to the clean paths — nothing else to configure.

### Netlify
1. Push to GitHub.
2. Netlify → Add new site → Import from Git.
3. Build command: leave blank. Publish directory: `.`
4. Deploy.
5. For the same clean-URL behavior on Netlify, add a `netlify.toml` with
   `[build] publish = "."` and redirects from `/index.html`, `/docs.html`,
   `/app.html` to `/`, `/docs`, `/app` (Netlify serves extensionless paths
   like `/docs` → `docs.html` automatically, so this is mainly for the
   redirect from the old `.html` URLs).

### GitHub Pages
1. Push this folder to the repo, e.g. `aiconhood/aicon-site`.
2. Repo Settings → Pages → Source: `main` branch, root folder.
3. Site will be live at `https://aiconhood.github.io/aicon-site/`.
4. GitHub Pages always serves the literal filename (`/docs.html`, not
   `/docs`) — it doesn't support clean URLs the way Vercel/Netlify do, so
   on Pages the links will show the `.html` extension.

## Customizing

- Brand colors and type live in `assets/style.css` (`:root` variables at the top: `--bg`, `--lime`, `--olive`).
- Replace the placeholder stats (`—`) in `index.html` under `.stats-band` once real routing volume exists.
- Wire the "Launch App" buttons to the actual app route once the router frontend is live.
- Contract addresses and audit links go in `docs.html` under the "Smart contracts" section.

## Disclaimer

AICON is an independent third-party application built on Robinhood Chain. It is not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc.
