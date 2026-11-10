# DINKSLOT

Book Your Slot. Own the Court. Multi-tenant pickleball court booking (PWA + Supabase).

- Build spec: [DINKSLOT_AI_PROMPT.md](DINKSLOT_AI_PROMPT.md)
- Docs: [docs/](docs/)
- Supabase project: `achwxeisrakxdtzmfbrc`

To run locally on Windows, install Python 3 and double-click `run-local.bat`.
It opens http://localhost:8000 in your browser. Keep the terminal open while using
the app; press Ctrl+C to stop. To use another port, run `run-local.bat 8080`.
The app uses the Supabase connection configured in `js/config.js`.

Secrets (service role key, Gmail credentials, Turnstile secret) never go in this repo. Only the Supabase URL and anon key ship in `js/config.js`.
