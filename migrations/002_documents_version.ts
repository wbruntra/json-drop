import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('documents')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('documents').dropColumn('version').execute()
}
