# PowerShell 版本的 WAF probe — Windows 環境用
# 從外網執行才有意義(內網直連 K8s 不過 WAF)
#
# 使用:
#   PS> .\server\scripts\probe-waf-webhook.ps1
#
# 預期:WAF 回 HTTP 403 + HTML body 含 "Reference #...",
#       腳本自動 grep 出來並把完整 response 印出

param(
  [string]$Url = "https://flgpt.foxlink.com.tw/api/webex/webhook"
)

$ErrorActionPreference = 'Continue'

Write-Host "[probe] POST $Url"
Write-Host "[probe] 從外網執行才有意義(內網直連 K8s 不過 WAF)"
Write-Host ""

$body = '{"id":"test-probe","resource":"messages","event":"created","data":{"id":"x","personEmail":"probe@example.com"}}'
$tmpBody = [System.IO.Path]::GetTempFileName()
$body | Out-File -Encoding ascii -NoNewline $tmpBody

$tmpOut = [System.IO.Path]::GetTempFileName()
try {
  & curl.exe -sS -i -X POST $Url `
    -H "Content-Type: application/json" `
    -H "X-Spark-Signature: abc123fakeprobehash" `
    -H "User-Agent: webex-probe/1.0" `
    --data-binary "@$tmpBody" `
    --compressed 2>&1 | Out-File -Encoding utf8 $tmpOut

  $raw = Get-Content $tmpOut -Raw

  Write-Host "=== HTTP response head ==="
  Get-Content $tmpOut -Head 8
  Write-Host ""

  $ref = [regex]::Match($raw, "Reference #[0-9a-f.]+").Value
  $status = ([regex]::Match($raw, "HTTP/[\d.]+\s+(\d+)").Groups[1].Value)

  if ($ref) {
    Write-Host "=== WAF 擋下 ✗  Reference 已抓到 ===" -ForegroundColor Red
    Write-Host $ref -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[probe] 把上面這串 Reference 給 WAF admin 查 Akamai console"
  }
  elseif ($status -in "200","204","401","400") {
    Write-Host "=== WAF 通過 ✓  HTTP $status ===" -ForegroundColor Green
    if ($status -in "401","400") {
      Write-Host "[probe] 401/400 = 後端拒假簽章,WAF 是過的"
    } else {
      Write-Host "[probe] WAF + 後端都通"
    }
  }
  else {
    Write-Host "=== HTTP $status 但沒抓到 Akamai Reference ===" -ForegroundColor Yellow
    Write-Host "[probe] 完整 response body(看下面找 reference 或別的擋下訊息):"
    Write-Host ""
    Write-Host "--- BODY ---"
    Write-Host $raw
    Write-Host "--- END ---"
  }
}
finally {
  Remove-Item $tmpBody -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "[probe] 完整 response 暫存於: $tmpOut"
}
