# One-time setup for booking emails. Run it yourself in PowerShell from the repo root, after
#   npx supabase login   and   npx supabase link --project-ref achwxeisrakxdtzmfbrc
#
# What it does (nothing is written to any file in the repo):
#   1. creates a random shared secret and stores it as the Edge secret WEBHOOK_SECRET
#   2. stores the webhook URL, the shared secret and the PUBLIC anon key in Supabase Vault,
#      which is where the database trigger reads them
#   3. optionally stores your Gmail API credentials as Edge secrets
#
# Examples
#   .\scripts\setup-email.ps1 -DryRun            # wiring test: logs emails as "sent" without sending
#   .\scripts\setup-email.ps1 -GmailClientId "..." -GmailClientSecret "..." -GmailRefreshToken "..." -GmailSender "you@gmail.com"
#   .\scripts\setup-email.ps1 -DryRun:$false     # turn dry run off after real credentials are set
param(
  [string]$GmailClientId,
  [string]$GmailClientSecret,
  [string]$GmailRefreshToken,
  [string]$GmailSender,
  [switch]$DryRun,
  [string]$SiteUrl
)
$ErrorActionPreference = "Stop"
$ref = "achwxeisrakxdtzmfbrc"
$cfg = Get-Content "$PSScriptRoot\..\js\config.js" -Raw
if ($cfg -notmatch 'SUPABASE_ANON_KEY:\s*"([^"]+)"') { throw "anon key not found in js/config.js" }
$anon = $Matches[1]

# 1. shared secret
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
npx supabase secrets set "WEBHOOK_SECRET=$secret" --yes | Out-Null
Write-Host "Edge secret WEBHOOK_SECRET set"

# 2. Vault entries read by the database trigger (create or update)
$sql = @"
do `$`$
declare
  pairs text[][] := array[
    array['edge_base_url', 'https://$ref.supabase.co/functions/v1'],
    array['edge_anon_key', '$anon'],
    array['booking_webhook_secret', '$secret']];
  i int; sid uuid;
begin
  for i in 1 .. array_length(pairs, 1) loop
    select id into sid from vault.secrets where name = pairs[i][1];
    if sid is null then perform vault.create_secret(pairs[i][2], pairs[i][1]);
    else perform vault.update_secret(sid, pairs[i][2], pairs[i][1]); end if;
  end loop;
end `$`$;
"@
npx supabase db query --remote --yes $sql | Out-Null
Write-Host "Vault entries stored (edge_base_url, edge_anon_key, booking_webhook_secret)"

# 3. optional settings
if ($GmailClientId -and $GmailClientSecret -and $GmailRefreshToken -and $GmailSender) {
  npx supabase secrets set "GMAIL_CLIENT_ID=$GmailClientId" "GMAIL_CLIENT_SECRET=$GmailClientSecret" "GMAIL_REFRESH_TOKEN=$GmailRefreshToken" "GMAIL_SENDER=$GmailSender" --yes | Out-Null
  Write-Host "Gmail secrets set"
}
if ($SiteUrl) { npx supabase secrets set "SITE_URL=$SiteUrl" --yes | Out-Null; Write-Host "SITE_URL set" }
if ($PSBoundParameters.ContainsKey("DryRun")) {
  if ($DryRun) { npx supabase secrets set "EMAIL_DRY_RUN=1" --yes | Out-Null; Write-Host "Dry run ON (emails are logged as sent, nothing is delivered)" }
  else { npx supabase secrets unset EMAIL_DRY_RUN --yes | Out-Null; Write-Host "Dry run OFF" }
}
Write-Host "Done. Create a booking and check: select * from email_log order by created_at desc;"
