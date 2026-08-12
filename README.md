# Home-Manager

Small, self-contained apps for running a household. Each lives in its own directory under
`apps/` with its own dependencies and can be built and deployed independently.

| App | What it does |
| --- | --- |
| [`apps/espresso`](apps/espresso) | Offline espresso dial-in coach — installable on iOS and Android |

## Working on an app

Everything is per-app; there is no workspace tooling to learn.

```bash
cd apps/espresso
npm install
npm run dev
```

## Deployment

`apps/espresso` deploys to GitHub Pages from whichever branch is the repository default, or on
demand from any branch via the **Deploy to GitHub Pages** workflow (Actions → Run workflow).

Pages must be enabled once first: **Settings → Pages → Build and deployment → GitHub Actions**.
The published URL is `https://<owner>.github.io/Home-Manager/`, and that is the address to open on
a phone to install the app.
