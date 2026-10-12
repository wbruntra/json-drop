import { initDatabase } from './kysely-db'
import app from './app'

await initDatabase(process.env.DATABASE_URL || 'db.sqlite')

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
})

console.log(`Listening on http://localhost:${server.port}`)
if (process.env.NODE_ENV === 'development') {
  console.log('Dev mode enabled')
  console.log('Dev endpoints: /api/dev/login, /api/dev/token')
}
