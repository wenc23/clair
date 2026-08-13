@echo off
setlocal

if "%~1"=="" goto :usage

node "%~dp0tools\flac-auto-metadata.cjs" %*
exit /b %ERRORLEVEL%

:usage
echo Usage: auto-metadata.cmd "Music folder" [--apply] [--watch] [--set KEY=VALUE]
echo.
echo Examples:
echo   auto-metadata.cmd "Z:\wc-zh\Music"
echo   auto-metadata.cmd "Z:\wc-zh\Music" --apply --watch
exit /b 1
