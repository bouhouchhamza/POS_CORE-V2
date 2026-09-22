import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('La prÃ©paration actuelle du sidecar cible uniquement Windows x64.')
}
const repository = path.resolve(import.meta.dirname, '..', '..', '..')
const output = path.join(repository, 'apps', 'desktop', 'src-tauri', 'binaries', 'corepos-local-api-x86_64-pc-windows-msvc.exe')
const entry = path.join(repository, 'apps', 'api', 'dist', 'src', 'local', 'server.js')
const bundledEntry = path.join(repository, 'apps', 'desktop', 'src-tauri', 'binaries', 'corepos-local-api.cjs')
const argon2Binding = path.join(repository, 'apps', 'desktop', 'src-tauri', 'binaries', 'argon2.win32-x64.node')
const argon2BindingSource = path.join(repository, 'node_modules', 'argon2', 'prebuilds', 'win32-x64', 'argon2.glibc.node')
const argon2Shim = path.join(repository, 'apps', 'desktop', 'scripts', 'argon2-node-gyp-build-shim.cjs')
const pkgConfig = path.join(repository, 'apps', 'desktop', 'src-tauri', 'binaries', 'corepos-local-api.pkg.cjs')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Ce script doit Ãªtre lancÃ© avec npm.')
const build = spawnSync(process.execPath, [npmCli, 'run', 'build', '-w', '@corepos/api'], { cwd: repository, stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)
fs.mkdirSync(path.dirname(output), { recursive: true })
if (!fs.existsSync(argon2BindingSource)) throw new Error('The Windows x64 Argon2 binding required by the desktop sidecar is unavailable.')
fs.copyFileSync(argon2BindingSource, argon2Binding)
const bundle = spawnSync(process.execPath, [npmCli, 'exec', '--', 'esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--target=node22', '--external:canvas', `--alias:node-gyp-build=${argon2Shim}`, `--outfile=${bundledEntry}`], { cwd: repository, stdio: 'inherit' })
if (bundle.error) throw bundle.error
if (bundle.status !== 0) process.exit(bundle.status ?? 1)
// The pkg config lives next to the bundled entry, so this relative asset is
// mounted at the same snapshot path that the shim requires.
fs.writeFileSync(pkgConfig, "module.exports={pkg:{assets:['argon2.win32-x64.node']}}", { flag: 'w' })
const pkg = spawnSync(process.execPath, [npmCli, 'exec', '--', 'pkg', '--config', pkgConfig, bundledEntry, '--targets', 'node22-win-x64', '--output', output, '--compress', 'GZip', '--fallback-to-source'], { cwd: repository, stdio: 'inherit' })
fs.rmSync(pkgConfig, { force: true })
if (pkg.error) throw pkg.error
if (pkg.status !== 0) process.exit(pkg.status ?? 1)
fs.rmSync(bundledEntry, { force: true })
console.log(`Sidecar local crÃ©Ã© : ${output}`)
