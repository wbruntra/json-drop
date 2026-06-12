import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { Kysely } from 'kysely'
import { Migrator, FileMigrationProvider } from 'kysely/migration'

export async function runMigrations(
  db: Kysely<any>,
  options: { silent?: boolean } = {},
): Promise<void> {
  const log = options.silent ? () => {} : console.log

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dir, 'migrations'),
    }),
  })

  const { error, results } = await migrator.migrateToLatest()

  if (results) {
    for (const it of results) {
      if (it.status === 'Success') {
        log(`  ✓ Applied migration: ${it.migrationName}`)
      } else if (it.status === 'Error') {
        log(`  ✗ Failed migration: ${it.migrationName}`)
      }
    }
  }

  if (error) {
    if (!options.silent) {
      console.error('Migration failed:', error)
    }
    throw error
  }
}

if (import.meta.main) {
  const dbPath = process.env.DATABASE_URL || 'db.sqlite'
  console.log(`Running migrations on ${dbPath}...`)

  const { Database } = await import('bun:sqlite')
  const { BunSqliteDialect } = await import('kysely-bun-dialects')

  const rawDb = new Database(dbPath, { create: true })
  rawDb.run('PRAGMA journal_mode = WAL')
  rawDb.run('PRAGMA foreign_keys = ON')

  const db = new Kysely<any>({
    dialect: new BunSqliteDialect({ database: rawDb }),
  })

  try {
    await runMigrations(db)
    console.log('Migrations complete.\n')
  } catch (err) {
    console.error(err)
    process.exit(1)
  } finally {
    await db.destroy()
    rawDb.close()
  }
}
