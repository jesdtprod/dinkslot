# Stage 3: auth and club registration

## Turnstile (Cloudflare) enforcement
| Where | How |
| --- | --- |
| Sign-up and sign-in | Supabase Auth "Attack Protection" CAPTCHA (provider `turnstile`). The widget token is passed as `captchaToken`; Auth rejects requests without it, even direct API calls. |
| Club registration | `verify-turnstile` Edge Function checks the token with Cloudflare, then records a one-time row in `captcha_passes`. `register_club` consumes a pass (10 minute expiry), so it cannot be called without CAPTCHA. |

Keys: the **site key** is public (`js/config.js`). The **secret key** is only a Supabase secret (`TURNSTILE_SECRET_KEY`) and is also configured in Auth. Allowed Turnstile hostnames: `jesdtprod.github.io` and `localhost`.

## Auth settings pushed
Site URL `https://jesdtprod.github.io/dinkslot/`; redirect URLs include `http://localhost:8080`. Undeclared Auth settings were left untouched.

## Screens added
Sign in / create account (`/#/auth`), join a club (`/#/c/<slug>/join`), register club (`/#/register-club`), my account (`/#/me`), platform console (`/#/platform`), plus a basic landing grid and club page.

## Making someone platform admin
Sign up in the app first, then run:

    npx supabase db query --remote --yes "update public.profiles set is_platform_admin = true where auth_user_id = (select id from auth.users where email = '<email>')"

## Local run
    npx serve -l 8080     (or: python -m http.server 8080)   then open http://localhost:8080

## Verification
- Isolation test now 115 checks, 0 failures (adds CAPTCHA gate, pass forging, platform console access).
- Live: signup without captcha is refused; Edge Function returns 401 without a real user session; anon cannot read `tenants`; `public_clubs` returns `[]` until a club is approved.
