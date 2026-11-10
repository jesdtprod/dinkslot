# Gmail API setup (booking emails)

DINKSLOT sends mail through the Gmail API over HTTPS from the `send-booking-email` Edge Function.
SMTP is not used (Supabase Edge Functions cannot open ports 25 and 587). You need four values:
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`.

## 1. Google Cloud project
1. Open https://console.cloud.google.com and create a project (for example "DINKSLOT").
2. APIs and services > Library > search "Gmail API" > Enable.
3. APIs and services > OAuth consent screen: user type External, app name DINKSLOT, your email as support and developer contact. Add the sending Gmail address as a **Test user**.
4. Data access (scopes): add `https://www.googleapis.com/auth/gmail.send` only.

## 2. OAuth client
1. APIs and services > Credentials > Create credentials > OAuth client ID.
2. Application type **Web application**.
3. Authorized redirect URI: `https://developers.google.com/oauthplayground`
4. Copy the **Client ID** and **Client secret**.

## 3. Refresh token
1. Open https://developers.google.com/oauthplayground
2. Gear icon > tick **Use your own OAuth credentials** > paste the client ID and secret.
3. In step 1 type the scope `https://www.googleapis.com/auth/gmail.send` > Authorize APIs > sign in as the **sending Gmail address** and allow.
4. Step 2 > **Exchange authorization code for tokens** > copy the **Refresh token**.

Note: while the consent screen is in "Testing", Google expires refresh tokens after 7 days. For a pilot, press **Publish app** (In production). An unverified app that only sends mail from its own account keeps working; Google shows a warning only to the owner during consent.

## 4. Store the secrets
Run in your own terminal (after `npx supabase login` and the project link):

    .\scripts\setup-email.ps1 -GmailClientId "<id>" -GmailClientSecret "<secret>" `
        -GmailRefreshToken "<token>" -GmailSender "<you@gmail.com>"

To test the wiring first without sending real mail, run `.\scripts\setup-email.ps1 -DryRun`, make a booking, and look at `email_log`; then turn it off with `-DryRun:$false`.

## Limits
A normal Gmail account can send about 500 messages a day (Google Workspace about 2,000). If you outgrow that, the send step is isolated behind a small `Mailer` interface in `supabase/functions/send-booking-email/index.ts`, so Resend can replace Gmail without touching the webhook, templates or `email_log`.
