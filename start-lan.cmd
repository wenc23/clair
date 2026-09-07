@echo off
if "%~1"=="" (
  echo Usage: start-lan.cmd "Z:\Music"
  echo    or: start-lan.cmd "\\NAS\Music"
  exit /b 1
)
set "CLAIR_HOST=0.0.0.0"
node "%~dp0lan-server.cjs" "%~1"
