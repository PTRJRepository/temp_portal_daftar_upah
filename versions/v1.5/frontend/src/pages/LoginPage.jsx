import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import '../styles/theme.css'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)
  const { login } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const success = await login(username, password)
    
    if (success) {
      setLoading(false)
      setLoginSuccess(true)
      // App.jsx will handle redirection based on isAuthenticated state update
    } else {
      setError('Login failed. Please check your credentials.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      background: '#f0fdf4', // Green-50
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Success Overlay */}
      {loginSuccess && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(22, 163, 74, 0.95)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          color: 'white',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            fontSize: '4rem',
            marginBottom: '1rem',
            animation: 'scaleUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
          }}>✅</div>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Login Berhasil!</h2>
          <p style={{ fontSize: '1.1rem', opacity: 0.9 }}>Mengalihkan ke Dashboard...</p>
        </div>
      )}

      {/* Left Side - Image & Branding */}
      <div style={{
        flex: '1',
        display: 'none',
        position: 'relative',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #16a34a 0%, #14532d 100%)', // Green-600 to Green-900
        color: 'white',
        padding: '4rem'
      }} className="login-sidebar">
        
        {/* Background Pattern Overlay (Optional) */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: 'url(/images/wallpaper_loading_screen.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.2,
          mixBlendMode: 'overlay'
        }}></div>

        <div style={{ position: 'relative', zIndex: 10, textAlign: 'center' }}>
          <img 
            src="/images/rebinmas.webp" 
            alt="Logo" 
            style={{ 
              height: '120px', 
              marginBottom: '2rem',
              filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.2))'
            }}
            onError={(e) => e.target.style.display = 'none'}
          />
          <h1 style={{ 
            fontSize: '2.5rem', 
            fontWeight: '800', 
            marginBottom: '1rem', 
            letterSpacing: '-0.025em' 
          }}>
            PT REBINMAS JAYA
          </h1>
          <p style={{ 
            fontSize: '1.25rem', 
            color: '#dcfce7', // Green-100
            fontWeight: '500' 
          }}>
            Sistem Laporan Daftar Upah
          </p>
        </div>
        
        <div style={{
          position: 'absolute',
          bottom: '2rem',
          fontSize: '0.875rem',
          color: '#86efac' // Green-300
        }}>
          &copy; {new Date().getFullYear()} Plantation Management System
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div style={{
        flex: '1',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem',
        background: 'white'
      }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <h2 style={{ 
              fontSize: '1.875rem', 
              fontWeight: '700', 
              color: '#14532d', // Green-900
              marginBottom: '0.5rem' 
            }}>
              Selamat Datang
            </h2>
            <p style={{ color: '#64748b' }}>Silakan login untuk mengakses dashboard</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {error && (
              <div style={{
                padding: '0.75rem',
                borderRadius: '0.5rem',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                fontSize: '0.875rem',
                border: '1px solid #fecaca',
                textAlign: 'center'
              }}>
                {error}
              </div>
            )}

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '0.875rem', 
                fontWeight: '600', 
                color: '#334155', 
                marginBottom: '0.5rem' 
              }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field"
                style={{ width: '100%', boxSizing: 'border-box', height: '44px' }}
                placeholder="Masukkan username Anda"
                required
              />
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '0.875rem', 
                fontWeight: '600', 
                color: '#334155', 
                marginBottom: '0.5rem' 
              }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                style={{ width: '100%', boxSizing: 'border-box', height: '44px' }}
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ 
                width: '100%', 
                height: '48px', 
                fontSize: '1rem', 
                marginTop: '1rem',
                background: 'linear-gradient(to right, #16a34a, #15803d)'
              }}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="spinner" style={{ width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent' }}></span>
                  Logging in...
                </span>
              ) : 'Masuk ke Dashboard'}
            </button>
          </form>
        </div>
      </div>

      {/* Mobile Hidden Sidebar CSS Logic */}
      <style>{`
        @media (min-width: 768px) {
          .login-sidebar {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  )
}