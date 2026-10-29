# One-click script to deploy the latest git changes to the production VPS.
# Run in PowerShell from project root: .\deploy-to-vps.ps1

Write-Host "Deploying latest main branch to takeboard.creativheads.com..." -ForegroundColor Cyan

$sshKey = "C:\Users\ADMIN\.ssh\creativheads_vps"
$vpsHost = "root@187.126.125.145"

ssh -i $sshKey $vpsHost "cd /opt/casting-manager && git fetch origin && git checkout main && git pull origin main && cd deploy/vps && docker compose up -d --build app"

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n Deployment successfully finished!" -ForegroundColor Green
    Write-Host "Hard refresh your browser (Ctrl + Shift + R) on https://takeboard.creativheads.com/#talent" -ForegroundColor Yellow
} else {
    Write-Host "`n Deployment encountered an error." -ForegroundColor Red
}
