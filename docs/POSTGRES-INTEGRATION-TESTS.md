# PostgreSQL integration tests

The PostgreSQL integration suite is `apps/api/src/server.integration.test.ts`. It is
enabled only when `TEST_DATABASE_URL` names a disposable database ending in `_test`.
Run it locally with a dedicated database, never with a production connection:

```powershell
$env:DATABASE_URL = 'postgresql://bimik_test:password@127.0.0.1:5432/bimik_core_v2_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:REQUIRE_POSTGRES_INTEGRATION = 'true'
npm run db:migrate
npm run test:postgres -w @bimik/api
```

`REQUIRE_POSTGRES_INTEGRATION=true` makes a missing or incorrectly named test URL
fail before tests run. The release-gate workflow provisions PostgreSQL 18 and sets
this variable, so skipped integration coverage cannot make CI pass.
