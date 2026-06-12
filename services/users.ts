import { getDb } from '../kysely-db'
import type { User } from '../kysely-db'

export async function createUser(
  githubId: string,
  email: string | null,
  displayName: string | null,
): Promise<User> {
  return getDb()
    .insertInto('users')
    .values({
      github_id: githubId,
      email,
      display_name: displayName,
    })
    .onConflict((oc) =>
      oc.column('github_id').doUpdateSet({
        email,
        display_name: displayName,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getUser(id: number): Promise<User | null> {
  const result = await getDb()
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function getUserByGithubId(githubId: string): Promise<User | null> {
  const result = await getDb()
    .selectFrom('users')
    .selectAll()
    .where('github_id', '=', githubId)
    .executeTakeFirst()
  return result ?? null
}
