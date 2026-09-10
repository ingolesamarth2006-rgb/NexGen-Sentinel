@echo off
setlocal
cd /d "%~dp0"
title NexGen Sentinel - SIH 2026

echo.
echo ============================================================
echo   NEXGEN SENTINEL - Mine Subsidence Intelligence Platform
echo ============================================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set PY=py
) else (
  set PY=python
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating Python environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :error
)

call ".venv\Scripts\activate.bat"

python -c "import fastapi,uvicorn,sklearn,numpy,pydantic" >nul 2>nul
if errorlevel 1 (
  echo [2/3] Installing required packages - first run only...
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  if errorlevel 1 goto :error
) else (
  echo [2/3] Dependencies ready.
)

echo [3/3] Starting dashboard at http://127.0.0.1:8000
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:8000"
echo.
echo Keep this window OPEN during the demo.
echo Press CTRL+C to stop NexGen Sentinel.
echo.
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
exit /b 0

:error
echo.
echo Setup failed. Check that Python 3.10+ is installed and available in PATH.
pause
exit /b 1
