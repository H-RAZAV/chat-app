import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { getTheme } from './theme'

document.documentElement.setAttribute('data-theme', getTheme())

createRoot(document.getElementById('root')).render(<App />)