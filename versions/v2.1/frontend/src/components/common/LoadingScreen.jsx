import { useEffect, useState, useRef } from 'react'
import { getBasePath } from '../../utils/prodModeUtils'
import {
  initializeLocationData,
  fetchProvinces,
  fetchRegencies
} from '../../utils/locationData'
import './LoadingScreen.css'

// Base system tips (always shown)
const SYSTEM_TIPS = [
  "Menghitung ribuan data karyawan dalam hitungan detik dengan akurasi tinggi.",
  "Integrasi data absensi, lembur, dan bonus dalam satu sistem terpadu.",
  "THR 2026 dihitung otomatis berdasarkan masa kerja dan gaji pokok.",
  "PPh 21 menggunakan metode TER sesuai peraturan perpajakan terbaru.",
  "Dashboard real-time menampilkan produktivitas per gang dan afdeling.",
  "Sistem payroll modern mengurangi kesalahan hitung secara signifikan.",
  "Data karyawan tersinkronisasi dengan database HR secara langsung.",
  "Laporan daftar upah bisa diekspor ke Excel dalam format resmi.",
  "Keamanan data karyawan terjamin dengan sistem autentikasi berlapis.",
  "Analisis komprehensif menampilkan breakdown setiap komponen upah."
]

// Location-based tips (from ibnux Indonesian location API)
const LOCATION_TIPS = [
  "Data wilayah Indonesia bersumber dari Ibnux - 38 provinsi tersedia.",
  "Memuat referensi 514 kabupaten/kota dari database wilayah Indonesia.",
  "Indonesia memiliki 7.000+ kecamatan dan 80.000+ desa/kelurahan.",
  "Provinsi Sumatera Selatan merupakan salah satu sentra kelapa sawit utama Indonesia.",
  "Wilayah Sumatera Selatan mencakup 17 kabupaten/kota dengan keanekaragaman tinggi.",
  "Integrasi data lokasi mendukung pelaporan payroll berbasis wilayah.",
  "Sistem dapat menghasilkan laporan berdasarkan divisi dan lokasi gang karyawan.",
  "Database wilayah Indonesia diperbarui secara berkala melalui API Ibnux."
]

const PROCESS_LABELS = [
  'Memuat data karyawan',
  'Mengambil data absensi',
  'Menghitung lembur',
  'Menghitung premi',
  'Menghitung potongan',
  'Menghitung PPh 21',
  'Menyusun laporan',
  'Menyimpan hasil'
]

export default function LoadingScreen({
  isLoading,
  message = 'Memuat data...',
  steps = [],
  gangCode,
  month,
  year
}) {
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState(0)
  const [currentTip, setCurrentTip] = useState(0)
  const [isActive, setIsActive] = useState(false)
  const [locationInfo, setLocationInfo] = useState(null)
  const [locationLoaded, setLocationLoaded] = useState(false)
  const prevStepsRef = useRef("[]")
  const startTimeRef = useRef(null)

  // Combined tips: system tips + location tips
  const ALL_TIPS = [...SYSTEM_TIPS, ...LOCATION_TIPS]

  // Initialize location data (fetch Indonesian regions from ibnux API)
  useEffect(() => {
    if (isLoading && !locationLoaded) {
      initializeLocationData().then(() => {
        setLocationLoaded(true)
        // After location data loads, fetch provinces for dynamic location display
        fetchProvinces().then(provinces => {
          if (provinces && provinces.length > 0) {
            const validProvs = provinces.filter(p => p?.id && p?.name)
            if (validProvs.length === 0) return
            const randomProv = validProvs[Math.floor(Math.random() * validProvs.length)]
            setLocationInfo({ type: 'province', data: randomProv })
            // Then fetch regencies
            fetchRegencies(randomProv.id).then(regencies => {
              if (regencies && regencies.length > 0) {
                const validRegs = regencies.filter(r => r?.id && r?.name)
                if (validRegs.length === 0) return
                const randomReg = validRegs[Math.floor(Math.random() * validRegs.length)]
                setLocationInfo({ type: 'regency', data: randomReg, province: randomProv })
              }
            })
          }
        })
      })
    }
  }, [isLoading, locationLoaded])

  // Cycle through tips (including location tips)
  useEffect(() => {
    if (!isLoading) return
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % ALL_TIPS.length)
    }, 4500)
    return () => clearInterval(interval)
  }, [isLoading])

  // Handle Log History
  useEffect(() => {
    if (isLoading && message) {
      setLogs(prev => {
        if (prev[prev.length - 1] === message) return prev
        const newLogs = [...prev, message]
        return newLogs.slice(-5)
      })
    }
  }, [message, isLoading])

  // Track active state
  useEffect(() => {
    setIsActive(isLoading)
  }, [isLoading])

  // Reset state on initial load
  useEffect(() => {
    if (isLoading && logs.length === 0 && message) {
      setLogs([message])
      startTimeRef.current = Date.now()
    }
    if (!isLoading) {
      setLogs([])
      setProgress(0)
      startTimeRef.current = null
    }
  }, [isLoading])

  // Progress animation
  useEffect(() => {
    if (!isLoading) {
      setProgress(100)
      return
    }

    const stepsString = JSON.stringify(steps || [])
    if (prevStepsRef.current === "[]" && stepsString !== "[]") {
      prevStepsRef.current = stepsString
    }

    let parsedSteps = []
    try {
      parsedSteps = JSON.parse(prevStepsRef.current !== "[]" ? prevStepsRef.current : stepsString)
    } catch (e) { }

    const totalDuration = parsedSteps.length > 0
      ? parsedSteps.reduce((sum, step) => sum + (step.duration || 1200), 0)
      : 10000

    let elapsed = (progress / 100) * totalDuration
    const interval = 50

    const timer = setInterval(() => {
      elapsed += interval
      const newProgress = Math.min((elapsed / totalDuration) * 100, 98)
      setProgress(prev => Math.max(prev, newProgress))
    }, interval)

    return () => clearInterval(timer)
  }, [isLoading])

  // Calculate elapsed time
  const elapsedSeconds = startTimeRef.current
    ? Math.floor((Date.now() - startTimeRef.current) / 1000)
    : 0

  if (!isLoading) return null

  const basePath = getBasePath()

  const hasReportInfo = gangCode || month || year

  return (
    <div className="loading-screen-overlay">
      {/* Animated background */}
      <div className="loading-screen-bg" />

      {/* Decorative ring */}
      <div className="loading-ring-container">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="#f59e0b" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Main content card */}
      <div className="loading-screen-content">

        {/* Logo Section */}
        <div className="loading-logo-container">
          <img
            src={`${basePath}/images/rebinmas.webp`}
            alt="PT Rebinmas Jaya"
            className="loading-logo"
            onError={(e) => {
              e.target.style.display = 'none'
            }}
          />
          <div className="loading-company-name">PT Rebinmas Jaya</div>
          <div className="loading-app-name">Payroll Intelligence System</div>
        </div>

        {/* Progress Section */}
        <div className="loading-progress-section">
          {/* Large percentage */}
          <div className="loading-progress-text">
            {isActive && <span className="loading-active-dot" />}
            {Math.round(progress)}%
          </div>

          {/* Progress bar */}
          <div className="loading-progress-bar-container">
            <div
              className="loading-progress-bar-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Report Info Pills */}
          {hasReportInfo && (
            <div className="loading-report-info">
              {gangCode && (
                <span className="info-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  {gangCode}
                </span>
              )}
              {month && year && (
                <span className="info-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {String(month).padStart(2, '0')}/{year}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="loading-divider" />

        {/* Tips / Fun Facts Section */}
        <div className="loading-tips-container">
          <div className="loading-tip-label">Tahukah Anda</div>
          <div key={currentTip} className="loading-tip-text">
            "{ALL_TIPS[currentTip]}"
          </div>
          {/* Location Info from ibnux API */}
          {isActive && (
            <div className="loading-location-info">
              {locationInfo ? (
                <div className="location-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  {locationInfo.type === 'regency' && locationInfo.province
                    ? `${locationInfo.data.name}, ${locationInfo.province.name}`
                    : locationInfo.data.name}
                </div>
              ) : (
                <div className="location-badge location-loading">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  Memuat data wilayah Indonesia...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Logs */}
        <div className="loading-logs-container">
          {logs.map((logMsg, index) => {
            const isLast = index === logs.length - 1
            return (
              <div key={`${logMsg}-${index}`} className="loading-log-item">
                <span className={`log-icon ${isLast ? 'processing' : 'completed'}`}>
                  {isLast ? '●' : '✓'}
                </span>
                <span>{logMsg}</span>
              </div>
            )
          })}
        </div>

        {/* Bottom stats row */}
        {isActive && (
          <div className="loading-stats-row">
            <div className="loading-stat-item">
              <div className="loading-stat-value">{elapsedSeconds}s</div>
              <div className="loading-stat-label">Waktu</div>
            </div>
            <div className="loading-stat-item">
              <div className="loading-stat-value">{logs.length}</div>
              <div className="loading-stat-label">Langkah</div>
            </div>
            <div className="loading-stat-item">
              <div className="loading-stat-value">v2.0</div>
              <div className="loading-stat-label">System</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}