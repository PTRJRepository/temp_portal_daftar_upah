import axios from 'axios'

export async function login(username, password) {
  try {
    console.log('[AuthService] Attempting login for:', username)
    const r = await axios.post('auth/login', { username, password })
    console.log('[AuthService] Login successful')
    return r.data
  } catch (error) {
    console.error('[AuthService] Login failed:', {
      status: error.response?.status,
      message: error.response?.data?.detail || error.message,
      username: username
    })
    throw error
  }
}

export async function getMe(token) {
  const r = await axios.get('auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  })
  return r.data
}

export async function getAccessibleDivisions(token) {
  const r = await axios.get('auth/accessible-divisions', {
    headers: { Authorization: `Bearer ${token}` }
  })
  return r.data
}

export async function getTestToken() {
  const r = await axios.get('auth/test-token')
  return r.data
}
