import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  parseNamedArguments,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'ci', 'windows-x64'),
  repositoryRoot
)
const artifactPaths = [
  'apps/backend-bun/dist/backend-manifest.json',
  'apps/backend-bun/dist/advx-backend-bun.exe',
  'apps/desktop/release/win-unpacked/ADVX Live.exe',
  'apps/desktop/release/win-unpacked/resources/app.asar',
  'apps/desktop/release/win-unpacked/resources/backend/advx-backend-bun.exe'
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function fileIdentity(path: string) {
  const absolutePath = join(repositoryRoot, path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk)
  const info = await stat(absolutePath)
  verify(info.isFile() && info.size > 0, `packaged artifact is empty: ${path}`)
  return { path, sha256: hash.digest('hex'), bytes: info.size }
}

async function commandOutput(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await child.exited
  const stdout = (await stdoutPromise).trim()
  const stderr = (await stderrPromise).trim()
  verify(exitCode === 0 && stdout !== '', `${command[0]} failed: ${stderr}`)
  return stdout
}

await runMachineCli(async () => {
  verify(
    process.platform === 'win32' && process.arch === 'x64',
    'CI package manifest currently supports Windows x64 only'
  )
  verify(Bun.version === '1.3.14', `expected Bun 1.3.14, got ${Bun.version}`)

  const files = await Promise.all(artifactPaths.map(fileIdentity))
  const compiledBackend = files.find((file) => file.path === artifactPaths[1])
  const packagedBackend = files.find((file) => file.path === artifactPaths[4])
  verify(compiledBackend !== undefined && packagedBackend !== undefined, 'backend artifacts are missing')
  verify(
    compiledBackend.sha256 === packagedBackend.sha256 &&
      compiledBackend.bytes === packagedBackend.bytes,
    'packaged backend does not match the compiled backend'
  )

  const backendManifest = JSON.parse(
    await readFile(join(repositoryRoot, artifactPaths[0]), 'utf8')
  ) as { reproducibilityInputs?: { packageManager?: unknown } }
  verify(
    backendManifest.reproducibilityInputs?.packageManager === `bun@${Bun.version}`,
    'backend manifest does not identify Bun as package manager'
  )

  const manifest = {
    schemaVersion: 1,
    taskId: 'CUT-006',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    gitHead: await commandOutput(['git', 'rev-parse', 'HEAD']),
    githubSha: process.env.GITHUB_SHA ?? null,
    platform: { os: process.platform, arch: process.arch },
    runtime: { bun: Bun.version, packageManager: `bun@${Bun.version}` },
    package: {
      format: 'electron-builder-unpacked-directory',
      signed: false,
      published: false,
      files
    },
    backendIdentityPreserved: true
  }
  const manifestPath = join(artifactRoot, 'artifact-manifest.json')
  await writeJsonAtomic(manifestPath, manifest)
  return {
    manifest: relative(repositoryRoot, manifestPath).replace(/\\/g, '/'),
    files: files.length,
    backendIdentityPreserved: true
  }
})
