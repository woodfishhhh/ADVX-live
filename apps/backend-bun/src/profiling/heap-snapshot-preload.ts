import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const outputPath = process.env.ADVX_HEAP_PROFILE_PATH

if (outputPath !== undefined) {
  process.once('exit', () => {
    try {
      const snapshot = Bun.generateHeapSnapshot()
      writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
    } catch (error) {
      try {
        writeFileSync(
          `${dirname(outputPath)}${process.platform === 'win32' ? '\\' : '/'}heap-profile.error.txt`,
          error instanceof Error ? error.message : String(error),
          'utf8'
        )
      } catch {
        // The parent process records the child exit; never mask its result.
      }
    }
  })
}
