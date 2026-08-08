const [commandName, ownerTask] = process.argv.slice(2)

if (!commandName || !ownerTask) {
  console.error('Usage: migration-command-pending.mjs <command> <owner-task>')
  process.exitCode = 2
} else {
  console.error(
    `${commandName} is reserved by the root command contract and remains fail-closed until ${ownerTask}.`
  )
  process.exitCode = 1
}
