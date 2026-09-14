import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriRoot = resolve(desktopRoot, 'src-tauri')
const bundleIdArgument = process.argv.indexOf('--bundle-id')
const expectedBundleId = bundleIdArgument >= 0 ? process.argv[bundleIdArgument + 1] : 'bond.nextora.cafe'
assert.ok(
  expectedBundleId === 'bond.nextora.cafe' || expectedBundleId === 'bond.nextora.cafe.test',
  'Only the production or isolated Test BUNDLEID may be verified',
)
const config = JSON.parse(readFileSync(resolve(tauriRoot, 'tauri.conf.json'), 'utf8'))
const configuredHook = config.bundle?.windows?.nsis?.installerHooks

assert.equal(configuredHook, './windows/hooks.nsh', 'Tauri must configure the source-controlled NSIS hook')

const hookPath = resolve(tauriRoot, configuredHook)
const hook = readFileSync(hookPath, 'utf8')
assert.match(hook, /!macro\s+NSIS_HOOK_PREUNINSTALL/)
assert.match(hook, /StrCpy\s+\$DeleteAppDataCheckboxState\s+0/)

const generatedPath = resolve(tauriRoot, 'target/release/nsis/x64/installer.nsi')
if (existsSync(generatedPath)) {
  const generated = readFileSync(generatedPath, 'utf8')
  assert.ok(
    generated.includes(`!define BUNDLEID "${expectedBundleId}"`),
    `Generated installer must use the expected BUNDLEID ${expectedBundleId}`,
  )
  const hookInsert = generated.indexOf('!insertmacro NSIS_HOOK_PREUNINSTALL')
  const deleteCondition = generated.indexOf('${If} $DeleteAppDataCheckboxState = 1')
  const roamingDelete = generated.indexOf('RmDir /r "$APPDATA\\${BUNDLEID}"')
  const localDelete = generated.indexOf('RmDir /r "$LOCALAPPDATA\\${BUNDLEID}"')

  assert.ok(hookInsert >= 0, 'Generated NSIS must invoke NSIS_HOOK_PREUNINSTALL')
  assert.ok(deleteCondition > hookInsert, 'The hook must run before the AppData deletion condition')
  assert.ok(roamingDelete > deleteCondition, 'Roaming AppData deletion must stay inside the disabled block')
  assert.ok(localDelete > deleteCondition, 'Local AppData deletion must stay inside the disabled block')

  const recursiveAppDataDeletes = generated.match(/RmDir\s+\/r\s+"\$(?:LOCAL)?APPDATA\\\$\{BUNDLEID\}"/g) ?? []
  assert.equal(recursiveAppDataDeletes.length, 2, 'Review required: generated AppData deletion paths changed')
}

console.log('NSIS business-data preservation guard verified.')

