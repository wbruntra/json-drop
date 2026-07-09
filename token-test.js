import { JsonDrop } from './sdk/src/index'

const db = new JsonDrop({
  baseUrl: 'http://localhost:5174',
  token: 'jd_da830c78e7114864a5da3e2ee186be2080a32322618a493281c0d46cfe9ef727', // authenticate requests
  project: '8qfjdCzuDQNjyYsKQEXcAM', // scope anonymous operations to this project
  // secret: 'your-optional-access-secret' // default access secret for private docs
})

const user = await db.me()

console.log('user', user)

// list your projects
const projects = await db.projects.list()

console.log('projects', projects)

// const doc = await db
//   .doc('checkins')
//   .set({ time: new Date().toISOString() }, { accessMode: 'public' })
// console.log('doc', doc)

// const savedDoc = await db.doc('checkins').get()

// console.log('savedDoc', savedDoc)

await db.collection('checkins').add({ time: new Date().toISOString() })
const { docs } = await db.collection('checkins').list()
console.log(docs)
