@echo off
setlocal
cd /d "%~dp0"
title Agent Writer
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 from https://nodejs.org and open this file again.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Agent Writer requires Node.js 22 or later. Node.js 24 is recommended.
  pause
  exit /b 1
)
if not exist "node_modules\pdfjs-dist\package.json" (
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install
  ) else (
    call pnpm install --frozen-lockfile
  )
  if errorlevel 1 (
    echo Dependencies could not be installed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
node server.mjs --open
if errorlevel 1 pause
