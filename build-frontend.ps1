# Rebuild the React frontend into server\public after design changes.
# Usage (PowerShell, from D:\casting-manager):  .\build-frontend.ps1
Set-Location "$PSScriptRoot\frontend"
if (-not (Test-Path "node_modules")) { npm install }
npx vite build --outDir ..\server\public --emptyOutDir
Set-Location $PSScriptRoot
