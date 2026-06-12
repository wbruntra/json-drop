import axios from 'axios'

const token = 'jd_40e73e1b73bd4670b26f0d3bd48dd2676d7ecce6c8ab4ea18d1721265822b8f0'
const PORT = process.env.PORT || 11099

const {
  data: { docs, storage },
} = await axios.get(`http://localhost:${PORT}/api/docs`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
})

console.log('docs', docs)
console.log('storage', storage)
