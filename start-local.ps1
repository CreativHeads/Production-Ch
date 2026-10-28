# Run TakeBoard by CreativHeads on this computer: http://localhost:3456
# Usage (PowerShell, from D:\casting-manager):  .\start-local.ps1
# Press Ctrl+C to stop.
$env:APP_DEBUG = "1"
$env:SECURE_COOKIES = "0"
$env:PORT = "3456"
$env:DATA_DIR = "$PSScriptRoot\server-data"
# First run only: create the local admin account (username "admin").
if (-not (Test-Path "$PSScriptRoot\server-data")) {
  $env:ADMIN_USERNAME = "admin"
  $env:ADMIN_NAME = "Studio Admin"
  $env:ADMIN_PASSWORD = Read-Host "Choose a password for the local admin account (10+ characters)"
}

Set-Location "$PSScriptRoot\server"
if (-not (Test-Path "node_modules")) { npm install }
Write-Host "Open http://localhost:3456 in your browser (Ctrl+C to stop)"
node src/index.js
