import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('github_id', 'text', (col) => col.unique().notNull())
    .addColumn('email', 'text')
    .addColumn('display_name', 'text')
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createTable('api_tokens')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.unique().notNull())
    .addColumn('permissions', 'text', (col) => col.defaultTo('read_write').notNull())
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('revoked_at', 'text')
    .execute()

  await db.schema
    .createTable('documents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('path', 'text', (col) => col.notNull())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade'))
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('access_mode', 'text', (col) => col.defaultTo('public').notNull())
    .addColumn('access_secret', 'text')
    .addColumn('size_bytes', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('unique_user_id_path', ['user_id', 'path'])
    .execute()

  await db.schema
    .createIndex('idx_documents_user_path')
    .ifNotExists()
    .on('documents')
    .columns(['user_id', 'path'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_documents_user_path').ifExists().execute()
  await db.schema.dropTable('documents').ifExists().execute()
  await db.schema.dropTable('api_tokens').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
}
