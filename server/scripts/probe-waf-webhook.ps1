# PowerShell WAF probe for Webex webhook path
# Run from EXTERNAL network only (home / 4G). Internal network bypasses WAF.
#
# Usage:
#   PS> .\server\scripts\probe-waf-webhook.ps1
#
# Output:
#   HTTP 403 + Akamai Reference # -> WAF blocked, give Reference # to WAF admin
#   HTTP 200/401/400              -> WAF passed (401/400 = backend rejects fake signature, still OK)

param(
  [string]$Url = "https://flgpt.foxlink.com.tw/api/webex/webhook"
)

$ErrorActionPreference = 'Continue'

Write-Host "[probe] POST $Url"
Write-Host "[probe] Run from EXTERNAL network only. Internal bypasses WAF."
Write-Host ""

$body = '{"id":"test-probe","resource":"messages","event":"created","data":{"id":"x","personEmail":"probe@example.com"}}'
$tmpBody = [System.IO.Path]::GetTempFileName()
$body | Out-File -Encoding ascii -NoNewline $tmpBody

$tmpOut = [System.IO.Path]::GetTempFileName()
try {
  # Simulate Webex cloud real UA (2026-05-11 confirmed Akamai Bot Manager filters CiscoSparkBot UA)
  $ua = "Mozilla/5.0 (compatible; CiscoSparkBot)"
  & curl.exe -sS -i -X POST $Url `
    -H "Content-Type: application/json" `
    -H "X-Spark-Signature: abc123fakeprobehash" `
    -H "User-Agent: $ua" `
    --data-binary "@$tmpBody" `
    --compressed 2>&1 | Out-File -Encoding utf8 $tmpOut

  $raw = Get-Content $tmpOut -Raw

  Write-Host "=== HTTP response head ==="
  Get-Content $tmpOut -Head 8
  Write-Host ""

  # Akamai sometimes HTML-encodes Reference # as &#32;&#35; - decode first then match
  $decoded = $raw -replace '&#46;', '.' -replace '&#32;', ' ' -replace '&#35;', '#'
  $ref = [regex]::Match($decoded, "Reference #[0-9a-f.]+").Value
  $status = ([regex]::Match($raw, "HTTP/[\d.]+\s+(\d+)").Groups[1].Value)

  if ($ref) {
    Write-Host "=== WAF BLOCKED  Reference captured ===" -ForegroundColor Red
    Write-Host $ref -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[probe] Send Reference above to WAF admin for Akamai console lookup"
  }
  elseif ($status -in "200","204","401","400") {
    Write-Host "=== WAF PASSED  HTTP $status ===" -ForegroundColor Green
    if ($status -in "401","400") {
      Write-Host "[probe] 401/400 means backend rejected fake signature - WAF is OK"
    } else {
      Write-Host "[probe] WAF and backend both reachable"
    }
  }
  else {
    Write-Host "=== HTTP $status  but no Akamai Reference found ===" -ForegroundColor Yellow
    Write-Host "[probe] Full response body below:"
    Write-Host ""
    Write-Host "--- BODY ---"
    Write-Host $raw
    Write-Host "--- END ---"
  }
}
finally {
  Remove-Item $tmpBody -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "[probe] Full response saved to: $tmpOut"
}
