import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Font Awesome wird mitgebaut statt vom CDN geladen – das Add-on soll auch
// ohne Internetzugang funktionieren.
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
