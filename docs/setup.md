# Setup

1. Frontend: static files at repo root, served by GitHub Pages (Settings > Pages > main / root).
2. Backend: Supabase project `achwxeisrakxdtzmfbrc`. Use the CLI via `npx supabase`.
3. Link: `npx supabase login` then `npx supabase link --project-ref achwxeisrakxdtzmfbrc`.
4. Migrations live in `supabase/migrations/`; push with `npx supabase db push`.
5. Routing uses hash routes (`/#/c/<slug>`) because GitHub Pages has no wildcard subdomains.
