import axios from 'axios'

const token = 'jd_66da9a4246eb4cbc890d9ca9e29a014f41cb3886bdd5459581add6e62e1bef11'

const res = await axios.post(
  'http://localhost:3000/api/docs',
  {
    name: 'config',
    content: { theme: 'light' },
    access_mode: 'public',
  },
  {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  },
)

console.log(res.data)
// const { id, access_secret } = await res.json()

// console.log('id', id)
// console.log('access_secret', access_secret)

// curl http://localhost:3000/api/docs/5GQG2dVtJH9zVWti9X79D6
