@echo off
setlocal
node "%~dp0server.cjs"
exit /b %ERRORLEVEL%
