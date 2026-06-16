import { initDatabase } from './kysely-db'
import { createServer } from './server'

async function bootstrap() {
  await initDatabase(process.env.DATABASE_URL || 'db.sqlite')

  const server = createServer({
    port: Number(process.env.PORT) || 3000,
  })

  console.log(`Listening on http://localhost:${server.port}`)
  if (process.env.NODE_ENV === 'development') {
    console.log('Dev mode enabled')
    console.log('Dev endpoints: /api/dev/login, /api/dev/token')
  }
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
