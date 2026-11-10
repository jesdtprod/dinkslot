# Runs the isolation test against the linked Supabase project and prints the full report.
# Usage: powershell -File supabase/tests/run-isolation.ps1 [-Pages 12]
param([int]$Pages = 14)
$src = Get-Content "$PSScriptRoot/isolation_test.sql" -Raw
function Invoke-Page($n) {
  $tmp = Join-Path $env:TEMP "dinkslot_iso_$n.sql"
  $src.Replace('__PAGE__', "$n") | Set-Content $tmp -Encoding utf8
  $out = (npx --yes supabase db query --remote --yes -f $tmp 2>&1 | Out-String)
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if ($out -match 'ERROR:\s+P0001: (.*?)"\}\}') { return ($Matches[1] -replace '\\\\n', "`n" -replace '\\n', "`n") }
  return $out
}
Write-Host "===== SUMMARY ====="
Write-Host (Invoke-Page 0)
Write-Host "===== FULL REPORT ====="
$all = ''
for ($i = 1; $i -le $Pages; $i++) { $all += (Invoke-Page $i) }
Write-Host $all
