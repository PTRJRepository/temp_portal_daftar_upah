import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/animations.css'
import './utils/httpSetup'
import 'ag-grid-enterprise'

// Force disable cache in development
if (import.meta.env.DEV) {
  localStorage.setItem('disable-cache', Date.now().toString())
  sessionStorage.setItem('cache-buster', Date.now().toString())
}

const mount = document.getElementById('root') || (() => {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  return el
})()

ReactDOM.createRoot(mount).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
