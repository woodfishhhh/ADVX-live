import { Database } from 'bun:sqlite'

const [databasePath, phase] = process.argv.slice(2)
if (
  databasePath === undefined ||
  (phase !== 'before-commit' && phase !== 'after-commit')
) {
  process.exit(64)
}

const database = new Database(databasePath, {
  readwrite: true,
  strict: true
})
database.run('PRAGMA busy_timeout = 5000')
database.run('BEGIN IMMEDIATE')
database.query('INSERT INTO crash_probe (phase) VALUES (?)').run(phase)
if (phase === 'before-commit') process.exit(31)
database.run('COMMIT')
process.exit(32)
