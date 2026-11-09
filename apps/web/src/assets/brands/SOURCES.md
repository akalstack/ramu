Brand marks for forges, hosting platforms, databases and services, in each brand's own colors. Each mark sits beside the brand's name, never instead of it. A mark that is black on its own has a `-dark.svg` version for dark surfaces, which the desktop, the phone and the site pick by appearance.

| File | Source | Guidelines |
| --- | --- | --- |
| `github.svg`, `github-dark.svg` | [SVGL](https://svgl.app) | https://github.com/logos |
| `gitlab.svg` | SVGL | https://about.gitlab.com/handbook/marketing/corporate-marketing/brand-activation/trademark-guidelines/ |
| `bitbucket.svg` | [Simple Icons](https://simpleicons.org) 13.21 (CC0 1.0) in Bitbucket blue (#0052CC) | https://atlassian.design/foundations/logos |
| `azure-devops.svg` | [Devicon](https://devicon.dev) 2.16 (MIT) in Azure blue (#0078D7); neither SVGL nor Simple Icons carries it | https://learn.microsoft.com/azure/architecture/icons/ |
| `vercel.svg`, `vercel-dark.svg` | SVGL | https://vercel.com/geist/brands |
| `netlify.svg` | SVGL | https://www.netlify.com/press/ |
| `cloudflare.svg` | SVGL | https://www.cloudflare.com/trademark/ |
| `fly.svg` | SVGL | https://fly.io/docs/about/brand |
| `railway.svg`, `railway-dark.svg` | SVGL | https://railway.com/brand |
| `neon.svg` | SVGL | https://neon.com/brand |
| `postgres.svg` | SVGL | https://www.postgresql.org/about/policies/trademarks/ |
| `sentry.svg`, `sentry-dark.svg` | SVGL; the dark version is the same mark in white | https://sentry.io/branding/ |
| `expo.svg`, `expo-dark.svg` | SVGL; the dark version is the same mark in white | https://expo.dev/brand/ |
| `appstore.svg` | SVGL | https://developer.apple.com/app-store/marketing/guidelines/ |
| `googleplay.svg` | SVGL | https://partnermarketinghub.withgoogle.com/brands/google-play/ |
| `gemini.svg` | SVGL | https://about.google/brand-resource-center/ |
| `elevenlabs.svg`, `elevenlabs-dark.svg` | Simple Icons 13.21 (CC0 1.0), black and white | https://elevenlabs.io/brand |

After adding or changing a file here, add it to `BRAND_IDS` in `packages/shared/src/brands.ts` and run `node apps/mobile/scripts/gen-assets.mjs`.
