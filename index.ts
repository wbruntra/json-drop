import { initDatabase } from './database'
import { createServer } from './server'
import homepage from './frontend/index.html'

const isDev = process.env.NODE_ENV === 'development'

await initDatabase(process.env.DATABASE_URL || 'db.sqlite')

const server = createServer({
  port: Number(process.env.PORT) || 3000,
  homepage,
  development: isDev ? { hmr: true, console: true } : false,
})

console.log(`Listening on http://localhost:${server.port}`)
if (isDev) {
  console.log('Dev mode enabled')
  console.log('Dev endpoints: /api/dev/login, /api/dev/token')
}
