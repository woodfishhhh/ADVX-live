import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))
const artifactRoot = process.env.ADVX_VITEST_ARTIFACT_ROOT
  ? resolve(repositoryRoot, process.env.ADVX_VITEST_ARTIFACT_ROOT)
  : resolve(repositoryRoot, '.omx/artifacts/test-results')
const chromiumExecutable = process.env.ADVX_CHROMIUM_EXECUTABLE ?? (
  process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        process.env.LOCALAPPDATA
          ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
          : '',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      ].find((candidate) => candidate !== '' && existsSync(candidate))
    : undefined
)

mkdirSync(artifactRoot, { recursive: true })

const projectDefaults = {
  isolate: true,
  retry: 0,
  clearMocks: true,
  mockReset: true,
  restoreMocks: true,
  unstubEnvs: true,
  unstubGlobals: true,
  fakeTimers: {
    loopLimit: 10_000,
    shouldClearNativeTimers: true
  },
  hookTimeout: 30_000,
  maxConcurrency: 4
} as const

export default defineConfig({
  root: repositoryRoot,
  optimizeDeps: {
    include: ['react/jsx-dev-runtime']
  },
  test: {
    watch: false,
    passWithNoTests: true,
    teardownTimeout: 10_000,
    fileParallelism: true,
    minWorkers: 1,
    maxWorkers: 4,
    reporters: [
      'default',
      ['json', { outputFile: resolve(artifactRoot, 'vitest-results.json') }]
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: resolve(artifactRoot, 'coverage'),
      reporter: ['text', 'json-summary'],
      include: [
        'apps/backend-bun/src/**/*.ts',
        'apps/desktop/src/**/*.{ts,tsx}',
        'packages/contracts/src/**/*.ts'
      ],
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        '**/dist/**',
        '**/out/**',
        'packages/contracts/src/generated/**'
      ]
    },
    projects: [
      {
        test: {
          ...projectDefaults,
          name: 'backend-unit',
          include: ['tests/vitest/backend-unit.vitest.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true, isolate: true } },
          testTimeout: 195_000
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'backend-integration',
          include: ['tests/vitest/backend-integration.vitest.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true, isolate: true } },
          testTimeout: 195_000
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'desktop-main',
          include: ['apps/desktop/src/main/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true, isolate: true } },
          testTimeout: 30_000
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'desktop-preload',
          include: ['apps/desktop/src/preload/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true, isolate: true } },
          testTimeout: 30_000
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'desktop-renderer',
          include: ['apps/desktop/src/renderers/**/*.test.{ts,tsx}'],
          exclude: ['apps/desktop/src/**/*.browser.test.{ts,tsx}'],
          environment: 'happy-dom',
          pool: 'threads',
          poolOptions: { threads: { singleThread: false, isolate: true } },
          testTimeout: 20_000
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'desktop-browser',
          include: ['apps/desktop/src/**/*.browser.test.{ts,tsx}'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            isolate: true,
            fileParallelism: false,
            instances: [{
              browser: 'chromium',
              ...(chromiumExecutable
                ? { launch: { executablePath: chromiumExecutable } }
                : {})
            }],
            screenshotDirectory: resolve(artifactRoot, 'browser/screenshots'),
            screenshotFailures: true
          }
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'repository-contracts',
          include: ['tests/vitest/repository-contracts.vitest.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true, isolate: true } },
          testTimeout: 75_000
        }
      },
      {
        test: {
          ...projectDefaults,
          name: 'evidence-eval',
          include: ['tests/vitest/evidence-eval.vitest.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true, isolate: true } },
          testTimeout: 120_000
        }
      }
    ]
  }
})
