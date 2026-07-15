import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Anonymous principals reuse the `users` table (kind='anonymous') rather than
  // introducing a separate principals table, to avoid a disruptive rewrite of
  // every existing FK. github_id stays NOT NULL/UNIQUE; anonymous rows get a
  // synthetic `anon:<uuid>` value instead of relaxing the column (SQLite can't
  // drop a NOT NULL constraint without a full table rebuild).
  await db.schema
    .alterTable('users')
    .addColumn('kind', 'text', (col) => col.notNull().defaultTo('github'))
    .execute()

  await db.schema
    .createTable('sessions')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('token_hash', 'text', (col) => col.unique().notNull())
    .addColumn('expires_at', 'text', (col) => col.notNull())
    .addColumn('revoked_at', 'text')
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createTable('workspaces')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('project_id', 'text', (col) => col.references('projects.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('deleted_at', 'text')
    .execute()

  await db.schema
    .createTable('workspace_members')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('workspace_id', 'text', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('joined_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('removed_at', 'text')
    .execute()

  await db.schema
    .createIndex('idx_workspace_members_active')
    .ifNotExists()
    .on('workspace_members')
    .columns(['workspace_id', 'user_id'])
    .unique()
    .where(sql`removed_at`, 'is', null)
    .execute()

  await db.schema
    .createTable('workspace_invites')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('secret_hash', 'text', (col) => col.unique().notNull())
    .addColumn('expires_at', 'text')
    .addColumn('max_uses', 'integer')
    .addColumn('use_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('revoked_at', 'text')
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_workspace_invites_workspace')
    .ifNotExists()
    .on('workspace_invites')
    .column('workspace_id')
    .execute()

  await db.schema
    .createTable('member_recovery_links')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('secret_hash', 'text', (col) => col.unique().notNull())
    .addColumn('expires_at', 'text', (col) => col.notNull())
    .addColumn('used_at', 'text')
    .addColumn('revoked_at', 'text')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createTable('audit_events')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('workspace_id', 'text', (col) =>
      col.references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('target_type', 'text', (col) => col.notNull())
    .addColumn('target_id', 'text', (col) => col.notNull())
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_audit_events_workspace')
    .ifNotExists()
    .on('audit_events')
    .column('workspace_id')
    .execute()

  await db.schema
    .alterTable('documents')
    .addColumn('workspace_id', 'text', (col) =>
      col.references('workspaces.id').onDelete('cascade'),
    )
    .execute()

  // Unique per (workspace_id, path) — not per-author — so any member writing
  // to the same collaborative path updates the same shared document instead
  // of creating one row per author. Not partial: SQLite already treats NULL
  // as distinct-from-NULL in unique indexes, so legacy (workspace_id IS NULL)
  // documents never collide with each other here, and a plain (non-partial)
  // index is a valid ON CONFLICT target for upsertDocumentInWorkspace.
  await db.schema
    .createIndex('idx_documents_workspace_path')
    .ifNotExists()
    .on('documents')
    .columns(['workspace_id', 'path'])
    .unique()
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_documents_workspace_path').ifExists().execute()
  await db.schema.alterTable('documents').dropColumn('workspace_id').execute()
  await db.schema.dropTable('audit_events').ifExists().execute()
  await db.schema.dropTable('member_recovery_links').ifExists().execute()
  await db.schema.dropTable('workspace_invites').ifExists().execute()
  await db.schema.dropTable('workspace_members').ifExists().execute()
  await db.schema.dropTable('workspaces').ifExists().execute()
  await db.schema.dropTable('sessions').ifExists().execute()
  await db.schema.alterTable('users').dropColumn('kind').execute()
}
