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

`apps/espresso` deploys to GitHub Pages from `main` (or on demand via the **Deploy to GitHub
Pages** workflow). Pages must be enabled once, under **Settings → Pages → Build and deployment
→ GitHub Actions**.
