import axios from 'axios'

export async function fetchEmployees(token) {
  const r = await axios.get('/employees', { headers: { Authorization: `Bearer ${token}` } })
  return r.data
}
