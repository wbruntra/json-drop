import { initDatabase } from './kysely-db'
import app from './app'

// No top-level await: pm2's Bun container loads this file with require(),
// which rejects async (top-level await) modules.
async function main() {
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
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
