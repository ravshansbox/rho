# rho landing site

Static landing page at [runrho.dev](https://runrho.dev).

## Deploy

Deployed to Cloudflare Pages. From this directory:

```bash
npx wrangler pages deploy . --project-name=rho-site
```

Or use the wrapper (Termux):
```bash
cd site && wr pages deploy . --project-name=rho-site
```

## Files

- `index.html` -- Single-page site
- `_headers` -- Security headers + cache rules
- `_redirects` -- `/install` -> bootstrap.sh, `/docs` -> GitHub README
- `demo.gif` -- Terminal demo animation
