@echo off
rem Serves QuickGrade over HTTPS so a phone on the same Wi-Fi can use its camera.
cd /d "%~dp0"

set PY=
for %%P in (
  "%USERPROFILE%\anaconda3\python.exe"
  "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
  "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) do if exist %%P set PY=%%P

if "%PY%"=="" (
  where python >nul 2>nul && set PY=python
)
if "%PY%"=="" (
  echo Could not find Python on this computer.
  pause
  exit /b 1
)

%PY% serve.py --https
pause
