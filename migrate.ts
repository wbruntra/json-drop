import { Database } from 'bun:sqlite'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function runMigrations(db: Database, migrationsDir?: string): Promise<void> {
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')

  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const dir = migrationsDir || join(import.meta.dir, 'migrations')
  const files = await readdir(dir)
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  )

  for (const file of sqlFiles) {
    if (applied.has(file)) {
      console.log(`  Skipping ${file} (already applied)`)
      continue
    }

    console.log(`  Applying ${file}...`)
    const sql = await readFile(join(dir, file), 'utf-8')

    db.transaction(() => {
      db.run(sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
    })()

    console.log(`  ✓ Applied ${file}`)
  }
}

if (import.meta.main) {
  const db = new Database('db.sqlite', { create: true })
  console.log('Running migrations...')
  await runMigrations(db)
  console.log('Migrations complete.\n')
  db.close()
}
