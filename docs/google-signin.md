# Sign in with Google

The app already has **Sign in with Google** (sign-in screen) and **Sign up with Google** (sign-up screen). Until you finish the steps below the buttons show "Google sign-in is not available yet" instead of an error page. Nothing else changes: email and password keep working.

How it works: the button starts Supabase Auth's Google flow (PKCE). Google sends the person back to this site signed in; the profile name comes from their Google account, the email counts as confirmed (no confirmation email), and the booking intent ("I wanted to book at club X") is kept through the redirect, so the player lands on the booking page. The super admin email allowlist and the "one account, one club" rule apply to Google accounts as well.

## 1. Google Cloud (about 5 minutes)
Use the same Google Cloud project as the Gmail API if you have one.
1. https://console.cloud.google.com > APIs and services > **OAuth consent screen**. User type External, app name DINKSLOT, your support email. The default scopes (`openid`, `email`, `profile`) are enough. While the app is in **Testing**, only listed test users can sign in; press **Publish app** before the pilot so anyone can.
2. APIs and services > Credentials > **Create credentials > OAuth client ID** > Application type **Web application**.
3. **Authorized JavaScript origins**
   - `https://jesdtprod.github.io`
   - `http://localhost:8000`
   - `http://127.0.0.1:8000`
   - `http://localhost:8080`
4. **Authorized redirect URIs** (exactly this one, it is Supabase's callback, not the site's):
   - `https://achwxeisrakxdtzmfbrc.supabase.co/auth/v1/callback`
5. Create, then copy the **Client ID** and **Client secret**.

## 2. Supabase
Dashboard > Authentication > Sign In / Providers > **Google** > enable > paste the Client ID and Client secret > Save.

Also check Authentication > URL Configuration: Site URL `https://jesdtprod.github.io/dinkslot/` and the redirect list containing `https://jesdtprod.github.io/dinkslot/` and add `http://localhost:8000/` and `http://127.0.0.1:8000/` for local development (plus `http://localhost:8080/` if used). These must be added to the hosted Supabase project; editing `supabase/config.toml` affects local Supabase only. Keep the production Site URL unchanged.

## 3. Check it
- `https://achwxeisrakxdtzmfbrc.supabase.co/auth/v1/settings` should now show `"google":true` under `external`.
- On the sign-in screen click **Sign in with Google**, choose an account, and you return signed in. A new Google user gets a player profile automatically.
- Booking intent: open a club page while signed out > **Sign up to book** > **Sign up with Google** > you should land on that club's booking page.

## Good to know
- If the same email already has a password account, Supabase links the Google identity to it (both work).
- Club owners can sign in with Google too and are sent to their dashboard like any owner.
- Do not put the Google client secret in the repo. It lives only in Supabase.
