import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { getTheme } from './theme'

document.documentElement.setAttribute('data-theme', getTheme())

createRoot(document.getElementById('root')).render(<App />)

// the service worker only runs on the live site, so it never gets in the way while you build
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}