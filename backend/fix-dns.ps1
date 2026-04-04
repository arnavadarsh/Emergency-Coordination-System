# Run this script as Administrator to fix DNS resolution
# Right-click and select "Run as Administrator"

Write-Host "Adding Supabase hostname to hosts file..." -ForegroundColor Yellow

$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$entry = "13.203.58.43 db.xwvtawlrdgeulqnbviem.supabase.co"

# Check if entry already exists
$content = Get-Content $hostsPath
if ($content -contains $entry) {
    Write-Host "Entry already exists!" -ForegroundColor Green
} else {
    Add-Content -Path $hostsPath -Value "`n$entry"
    Write-Host "Entry added successfully!" -ForegroundColor Green
}

Write-Host "`nYou can now start the backend with: npm start" -ForegroundColor Cyan
pause
