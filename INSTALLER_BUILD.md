# Bimik_Cafe — Installer Build Guide

> How to build `Bimik_Cafe_Setup.exe` — a self-contained Windows installer that requires **no** Laragon, MySQL, npm, Composer, or terminal knowledge from the end user.

---

## Architecture Overview

```
End User's Machine
┌──────────────────────────────────────────────┐
│  %LocalAppData%\Bimik_Cafe\app\              │
│  ├── php/               (Portable PHP 8.3+)  │
│  ├── backend/           (Laravel + React)     │
│  │   ├── public/        (React build here)    │
│  │   ├── database/      (SQLite DB)           │
│  │   └── storage/       (images, cache)       │
│  ├── start.bat          (setup + open app)     │
│  ├── start-hidden.vbs   (hidden bat launcher)  │
│  ├── server-hidden.vbs  (hidden PHP server)    │
│  └── stop.bat           (stop server)          │
└──────────────────────────────────────────────┘

Shortcut → wscript start-hidden.vbs → start.bat
  → wscript server-hidden.vbs (fully hidden PHP)
  → Edge/Chrome --app=http://127.0.0.1:8000
```

---

## Prerequisites (Developer Machine Only)

| Tool | Version | Purpose |
|------|---------|---------|
| PHP | 8.3+ | Run Laravel artisan commands |
| Composer | 2.x | Install backend dependencies |
| Node.js | 18+ | Build React frontend |
| npm | 9+ | Frontend package manager |
| Inno Setup | 6+ | Compile the .exe installer |

---

## Step-by-Step Build Process

### Step 1: Install Backend Dependencies

```bash
cd backend
composer install --no-dev --optimize-autoloader
```

### Step 2: Build the React Frontend

```bash
cd frontend
npm install
npm run build
```

This creates `frontend/dist/` with the production React build.

### Step 3: Run the Automated Build Script

```bash
cd installer-package
.\build.bat
```

This script does **everything** automatically:
1. Builds the frontend (if not already done)
2. Copies backend to `installer-package/app/backend/`
3. Copies `frontend/dist/` into `app/backend/public/`
4. Sets up the installer `.env` (SQLite, file sessions, etc.)
5. Creates the SQLite database file
6. Runs migrations and seeds
7. Sets up storage directories

### Step 4: Place Portable PHP

Download **PHP 8.3+ for Windows** (VS16 x64 Thread Safe) from:
https://windows.php.net/download/

Extract into:
```
installer-package/app/php/
├── php.exe
├── php.ini          ← already provided, enables SQLite extensions
├── ext/
│   ├── php_pdo_sqlite.dll
│   ├── php_sqlite3.dll
│   ├── php_openssl.dll
│   ├── php_mbstring.dll
│   ├── php_fileinfo.dll
│   ├── php_curl.dll
│   ├── php_zip.dll
│   ├── php_gd.dll
│   └── php_opcache.dll
├── libcrypto-*.dll
├── libssl-*.dll
├── libsqlite3.dll
└── ... (other PHP files)
```

> **Important:** The `php.ini` in this folder is pre-configured. It will be picked up automatically by `php.exe`.

#### Required PHP Extensions

| Extension | Purpose |
|-----------|---------|
| `pdo_sqlite` | SQLite database access |
| `sqlite3` | SQLite support |
| `openssl` | Encryption, tokens |
| `mbstring` | String handling |
| `fileinfo` | File type detection |
| `curl` | HTTP client |
| `gd` | Image processing |
| `zip` | ZIP file support (optional) |
| `opcache` | Performance (optional) |

### Step 5: Test Locally

Before compiling the installer, test the package:

```bash
cd installer-package\app
.\start.bat
```

This should:
1. Run migrations if needed
2. Start the Laravel server on `http://127.0.0.1:8000`
3. Open the browser

**Test checklist:**
- [ ] Login with `patron@cafe.test` / `password`
- [ ] Dashboard loads
- [ ] Products page works
- [ ] Categories page works
- [ ] Sales/Caisse page works
- [ ] Commandes page works
- [ ] Stock page works
- [ ] Rapport page works
- [ ] WiFi settings page works
- [ ] Product/category images upload and display
- [ ] Sales page has worker filter dropdown
- [ ] Worker filter changes the report
- [ ] Print prints the filtered report
- [ ] Logout and login with `worker@cafe.test` / `password`
- [ ] Worker sees no sidebar — only full-width Commandes
- [ ] Worker cannot access /dashboard, /products, /categories, /sales, /stock, /rapport
- [ ] Worker can create commandes and print tickets
- [ ] Ticket printing works
- [ ] Thermal ticket print settings: destination thermal printer, paper size 80mm/58mm, margins none, scale 100%, headers/footers off
- [ ] Direct thermal printing works when enabled in Settings > Impression
- [ ] No PHP/terminal icon in taskbar
- [ ] Close browser, reopen `http://127.0.0.1:8000` — session persists
- [ ] Stop with `stop.bat`, restart with `start-hidden.vbs` — data persists

### Direct Thermal Printer Setup

Browser JavaScript cannot silently bypass the Chrome/Edge print dialog in a normal web app. Bimik_Cafe uses the local Laravel backend and `mike42/escpos-php` for direct ESC/POS ticket printing.

To configure a thermal printer:

1. Open Windows Settings > Bluetooth & devices > Printers & scanners.
2. Find the exact printer name, for example `POS-80`.
3. In Bimik_Cafe, login as patron and open Settings > Impression.
4. Enable `Impression directe`.
5. Put the exact printer name in `Nom imprimante thermique`.
6. Keep `Utiliser impression navigateur si imprimante directe indisponible` disabled if workers should never see the browser print dialog.
7. Save settings and test from Commandes.

If the backend returns `Imprimante non configurée ou indisponible.`:

- Verify the printer is installed, powered on, and not paused in Windows.
- Verify the setting matches the exact Windows printer name.
- If the driver requires a shared printer name, share the printer in Windows and use that share name.
- Test with `direct_print_enabled = false` only when you intentionally want to use the browser print dialog.

### Step 6: Compile with Inno Setup

1. Open **Inno Setup Compiler** (iscc.exe)
2. Open `installer-package/Bimik_Cafe_Installer.iss`
3. Click **Build** → **Compile**
4. The output will be: `installer-package/installer-output/Bimik_Cafe_Setup.exe`

**OR** compile from command line:
```bash
"C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer-package\Bimik_Cafe_Installer.iss
```

### Step 7: Test the Installer

1. Run `Bimik_Cafe_Setup.exe` on a clean machine (or VM)
2. Follow the wizard
3. Check the "Launch Bimik_Cafe" option at the end
4. Verify the app opens in the browser
5. Check Desktop shortcut works
6. Check Start Menu shortcut works
7. Test all features from Step 5 checklist
8. Test uninstall from Start Menu or Control Panel

---

## Manual Build (Without build.bat)

If you prefer manual steps:

```bash
# 1. Build frontend
cd frontend
npm run build

# 2. Prepare backend
cd ..\backend
composer install --no-dev --optimize-autoloader

# 3. Create package directory
mkdir ..\installer-package\app\backend

# 4. Copy backend (exclude dev files)
robocopy backend ..\installer-package\app\backend /E /XD node_modules .git tests /XF .env .phpunit.result.cache *.log

# 5. Copy React build to public
robocopy frontend\dist ..\installer-package\app\backend\public /E

# 6. Setup .env
copy backend\.env.installer.example ..\installer-package\app\backend\.env

# 7. Create SQLite DB
type nul > ..\installer-package\app\backend\database\database.sqlite

# 8. Run migrations
cd ..\installer-package\app\backend
php artisan migrate --force
php artisan db:seed --force

# 9. Clear caches
php artisan config:clear
php artisan route:clear
php artisan view:clear
php artisan optimize:clear

# 10. Create storage link
mklink /J public\storage storage\app\public
```

---

## Project Structure After Build

```
installer-package/
├── Bimik_Cafe_Installer.iss     ← Inno Setup script
├── build.bat                     ← Automated build script
├── installer-output/
│   └── Bimik_Cafe_Setup.exe      ← Final installer (after compile)
└── app/
    ├── php/                      ← Portable PHP 8.3+
    │   ├── php.exe
    │   ├── php.ini               ← Pre-configured
    │   └── ext/
    ├── backend/                  ← Laravel application
    │   ├── app/
    │   ├── bootstrap/
    │   ├── config/
    │   ├── database/
    │   │   └── database.sqlite   ← SQLite database
    │   ├── public/
    │   │   ├── index.html        ← React entry (from dist/)
    │   │   ├── assets/           ← React assets (from dist/)
    │   │   ├── storage/          ← Junction → storage/app/public
    │   │   └── index.php         ← Laravel entry
    │   ├── routes/
    │   ├── storage/
    │   ├── vendor/
    │   └── .env                  ← Installer config (SQLite)
    ├── start.bat                 ← Setup + open app
    ├── start-hidden.vbs          ← Hidden bat launcher (shortcuts)
    ├── server-hidden.vbs         ← Hidden PHP server (no taskbar)
    └── stop.bat                  ← Server stopper
```

---

## Configuration Differences: Dev vs Installer

| Setting | Dev (.env) | Installer (.env) |
|---------|-----------|-----------------|
| `APP_ENV` | `local` | `production` |
| `APP_DEBUG` | `true` | `false` |
| `DB_CONNECTION` | `mysql` | `sqlite` |
| `DB_DATABASE` | `ba7eti` | `database/database.sqlite` |
| `SESSION_DRIVER` | `database` | `file` |
| `CACHE_STORE` | `database` | `file` |
| `QUEUE_CONNECTION` | `database` | `sync` |
| `SESSION_LIFETIME` | `120` | `525600` (1 year) |
| `LOG_LEVEL` | `debug` | `error` |

---

## Troubleshooting

### Server won't start
- Check if port 8000 is already in use: `netstat -ano | findstr ":8000"`
- Run `stop.bat` then try again
- Verify PHP exists at `app/php/php.exe`

### PHP icon/console appears in taskbar
- Make sure `start.bat` uses `wscript.exe server-hidden.vbs` instead of `start /min`
- The `server-hidden.vbs` runs PHP with window style 0 (fully hidden)
- To test hidden launch:
  ```
  cd installer-package\app
  .\stop.bat
  wscript.exe .\start-hidden.vbs
  ```
- Expected: only Bimik_Cafe app window appears; no PHP/terminal taskbar icon

### Database errors
- Delete `database/database.sqlite` and restart the app (migrations will re-run)
- Check that `pdo_sqlite` extension is enabled in `php.ini`

### Images not loading
- Ensure `public/storage` junction exists pointing to `storage/app/public`
- If junction is broken: `mklink /J public\storage storage\app\public`

### Login not working
- Run `php artisan db:seed --force` to recreate default users
- Default credentials:
  - **Patron:** `patron@cafe.test` / `password`
  - **Worker:** `worker@cafe.test` / `password`
