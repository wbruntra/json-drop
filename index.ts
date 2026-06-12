import { initDatabase } from './kysely-db'
import { createServer } from './server'
import type { ServerOptions } from './server'

const isDev = process.env.NODE_ENV === 'development'

await initDatabase(process.env.DATABASE_URL || 'db.sqlite')

let homepage: ServerOptions['homepage']
if (!isDev) {
  homepage = (await import('./frontend/index.html')).default
}

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
