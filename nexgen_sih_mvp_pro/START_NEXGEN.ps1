Set-Location $PSScriptRoot
Write-Host "NexGen Sentinel - SIH 2026" -ForegroundColor Cyan
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}
& ".venv\Scripts\Activate.ps1"
python -c "import fastapi,uvicorn,sklearn,numpy,pydantic" 2>$null
if ($LASTEXITCODE -ne 0) { python -m pip install -r requirements.txt }
Start-Job { Start-Sleep -Seconds 4; Start-Process "http://127.0.0.1:8000" } | Out-Null
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
