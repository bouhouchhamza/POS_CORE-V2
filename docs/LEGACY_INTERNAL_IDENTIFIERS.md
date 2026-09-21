# CorePOS identity migration and legacy identifiers

## Renamed to CorePOS

The source package graph, TypeScript imports, Tauri build commands, Docker build
commands, Rust crate/library names, browser/application titles, new-backup
manifest name, receipts, activation, and printer messages use **CorePOS**.

| Previous active identifier | Current identifier |
| --- | --- |
| Root workspace `bimik-cafe` | `corepos` |
| `@bimik/api`, `@bimik/web`, `@bimik/desktop` | `@corepos/api`, `@corepos/web`, `@corepos/desktop` |
| `@bimik/shared-types`, `@bimik/validation` | `@corepos/shared-types`, `@corepos/validation` |
| Rust crate `bimik-cafe` / library `bimik_cafe_lib` | `corepos` / `corepos_lib` |

## Preserved for backward compatibility

The following identifiers are intentionally internal-only. They must not be
shown as product branding. Renaming any of them without a dedicated migration
and upgrade path can cause data loss, session loss, activation loss, duplicate
desktop installation, or tenant-routing failure.

| Legacy identifier | Classification | What would break if renamed |
| --- | --- | --- |
| Tauri identifier `bond.nextora.cafe` | Persistent compatibility | Windows treats a changed identifier as a separate app, risking duplicate installs and a new AppData location. |
| `Bimik Cafe` AppData folder and `bimik-cafe.sqlite` | Persistent compatibility | Existing desktop data, seed lineage, backups, and local database discovery would no longer resolve. |
| `BIMIK_*` environment variables | Persistent compatibility | Existing sidecar launchers and managed environments would stop passing local database/port configuration. |
| `bimik_refresh`, `bimik_*` cookies and `bimik_cafe_*` browser storage | Persistent compatibility | Existing authenticated sessions, device context, profiles, and language preferences would be lost. |
| `x-bimik-tenant`, `bimik_tenant_migrations`, tenant/application names | Persistent compatibility | Existing tenant routing and tenant migration history would fail or fork. |
| `bimik-bundled-*` product asset paths | Persistent compatibility | Existing product-image database references and bundled seed assets would fail to load. |
| Legacy backup manifest `Bimik Cafe` | Backup restore compatibility | Backups created before this migration would be rejected. New backups identify as `CorePOS`. |
| `bimik-cafe.exe` / `bimik-local-api.exe` updater process names | Persistent compatibility | The updater could leave an older installed process running while replacing files. |
| Historical SQL values in migration `0005_core_v2_universal_pos.sql` | Historical migration | Editing an already released migration would invalidate migration checksums and change historical data semantics. |
| Deployment service/database identifiers beginning with `bimik` | Production infrastructure | Existing volumes, secrets, CI/CD, and database targets would no longer match deployed infrastructure. |

Do not expose these values through customer-facing UI, receipts, reports,
activation screens, browser titles, desktop titles, or current user-facing
documentation.
