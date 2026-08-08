export {
  ADVX_SQLITE_BUSY_TIMEOUT_MS,
  ADVX_SQLITE_DATABASE_FILENAME,
  AdvxSqliteDatabase,
  AdvxSqliteDatabaseError,
  type AdvxSqliteCheckpoint,
  type AdvxSqliteDatabaseOptions,
  type AdvxSqliteDatabaseErrorCode,
  type AdvxSqliteDatabaseHealth,
  type AdvxSqliteOpenMode
} from './database'
export {
  createTemporaryAdvxSqliteDatabase,
  type TemporaryAdvxSqliteDatabase
} from './database-fixture'
export {
  classifySqliteFault,
  runWithSqliteFaultStatus,
  sqliteCrashRecoveryStatus,
  type SqliteCommitState,
  type SqliteFaultContext,
  type SqliteFaultDisposition,
  type SqliteFaultKind,
  type SqliteFaultOperation,
  type SqliteFaultResult,
  type SqliteFaultStatus
} from './fault-status'
export {
  ADVX_MIGRATION_JOURNAL_TABLE,
  SqliteMigrationError,
  calculateMigrationChecksum,
  runSqliteMigrations,
  type OnlineBackupReceipt,
  type SqliteMigration,
  type SqliteMigrationErrorCode,
  type SqliteMigrationResult,
  type SqliteOnlineBackupAdapter
} from './migration-runner'
export { ADVX_SQLITE_MIGRATIONS } from './migrations'
export {
  SqlitePersistenceError,
  type SqlitePersistenceErrorCode
} from './errors'
export {
  createSqliteRepositories,
  SqliteRoomRepository,
  SqliteRuntimeSpecRepository,
  SqliteSessionRepository,
  type SqliteRepositories
} from './repositories'
export { SqliteViewerInstanceRepository } from './viewer-repository'
export {
  SqliteRoomEventRepository,
  createRoomEventRecord
} from './room-event-repository'
export { SqliteRoomMemoryRepository } from './room-memory-repository'
export { SqliteModeMemeRepository } from './mode-meme-repository'
export { SqliteOutboxRepository } from './outbox-repository'
export { SqliteTransactionBoundary } from './transaction'
export {
  advxPersistenceSchema,
  modeMemeCandidates,
  modeMemeEvents,
  modeMemeSettings,
  modeMemes,
  durableOutbox,
  roomEvents,
  roomLongTermMemories,
  roomMemoryCandidates,
  roomMemoryEvidence,
  roomMemoryHeads,
  rooms,
  sessionRecords,
  sessionRuntimeRevisions,
  sessionViewerInstances
} from './schema'
