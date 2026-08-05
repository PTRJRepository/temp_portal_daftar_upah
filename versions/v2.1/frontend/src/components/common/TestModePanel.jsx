import { useEffect, useState } from 'react'
import { fetchDivisions, fetchGangs } from '../../services/gangService'

const TEST_MODE = (import.meta.env?.VITE_DEV_MODE === 'true') || (import.meta.env?.DEV_MODE === 'true')

export default function TestModePanel({ onChange }) {
  // TESTING ONLY
  const [divisions, setDivisions] = useState([])
  const [division, setDivision] = useState('')
  const [gangs, setGangs] = useState([])
  const [gangCode, setGangCode] = useState('H1H')
  const [month, setMonth] = useState(5)
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    if (!TEST_MODE) return
    ;(async () => {
      try {
        const dv = await fetchDivisions('')
        setDivisions(dv || [])
        const d = dv?.[0] || 'PG1A'
        setDivision(d)
        const gs = await fetchGangs('', d)
        setGangs(gs || [])
        const g = (gs && gs[0]) || 'H1H'
        setGangCode(g)
        onChange && onChange({ gangCode: g, month, year })
      } catch (_) {
        onChange && onChange({ gangCode, month, year })
      }
    })()
  }, [])

  useEffect(() => {
    onChange && onChange({ gangCode, month, year })
  }, [gangCode, month, year])

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  return (
    <div style={{ padding: 12, border: '1px dashed #f90', marginBottom: 12, background: '#fffbe6' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>TESTING ONLY: Quick filters (gang, month, year)</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label>
          Division:
          <select value={division} onChange={async (e) => {
            const d = e.target.value
            setDivision(d)
            try {
              const gs = await fetchGangs('', d)
              setGangs(gs || [])
              const g = (gs && gs[0]) || 'H1H'
              setGangCode(g)
            } catch (_) {}
          }} style={{ marginLeft: 6 }}>
            {divisions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Gang:
          <select value={gangCode} onChange={(e) => setGangCode(e.target.value)} style={{ marginLeft: 6 }}>
            {gangs.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          Month:
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ marginLeft: 6 }}>
            {months.map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
        </label>
        <label>
          Year:
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ marginLeft: 6 }}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

