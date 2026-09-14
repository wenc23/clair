@echo off
setlocal
rem Clair LAN server bound to a LOCAL music library.
rem No Samba share and no mapped drive required.
rem
rem Usage: start-lan-local.cmd ["D:\Path\To\Music"]
rem Path priority: 1) first argument  2) CLAIR_MUSIC_DIR  3) %USERPROFILE%\Music\Music

set "LIB=%~1"
if "%LIB%"=="" set "LIB=%CLAIR_MUSIC_DIR%"
if "%LIB%"=="" set "LIB=%USERPROFILE%\Music\Music"

if not exist "%LIB%" (
  echo [ERROR] Music directory not found:
  echo         %LIB%
  echo         Pass the path as the first argument, for example:
  echo         start-lan-local.cmd "D:\Music"
  exit /b 1
)

set "CLAIR_HOST=0.0.0.0"
echo Library  : %LIB%
echo This PC  : http://127.0.0.1:8000
echo Phone    : http://THIS-PC-LAN-IP:8000    (run ipconfig to find the IPv4 address)
echo Press Ctrl+C to stop.
node "%~dp0lan-server.cjs" "%LIB%"
