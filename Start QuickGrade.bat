@echo off
rem QuickGrade launcher - double-click this file.
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
  echo Install it from https://python.org and run this file again.
  pause
  exit /b 1
)

echo Starting QuickGrade...
%PY% serve.py %*
pause
