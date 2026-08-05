import axios from 'axios'

export async function fetchGangs(token, division = null, search = null, force = false, locCode = null) {
  const params = {}
  if (division) params.division = division
  if (search) params.search = search
  if (force) params.force = force
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  if (locCode) {
    const r = await axios.get('payroll/gangs/by-loc', { headers, params: { loc_code: locCode, force } })
    return r.data
  }
  const r = await axios.get('payroll/gangs', { headers, params })
  return r.data
}

export async function fetchDivisions(token) {
  const r = await axios.get('payroll/divisions', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  })
  return r.data
}

export async function fetchGangInfo(token, gangCode) {
  const r = await axios.get(`payroll/gang/${gangCode}/info`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  })
  return r.data
}

export async function fetchCurrentPeriod(token) {
  const r = await axios.get('payroll/current-period', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  })
  return r.data
}
