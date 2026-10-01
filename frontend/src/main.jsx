import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/global.css'

// HashRouter (rutas tipo /#/inicio) en vez de BrowserRouter: el hosting
// sirve el sitio con nginx sin Apache (ignora .htaccess) y no hay acceso a
// su configuración, así que una ruta "limpia" (/inicio, /prioridades...)
// devolvía 404 al recargar o al abrir un enlace directo. Lo que va después
// del # nunca llega al servidor — siempre se pide "/" y React Router
// resuelve la página. Cambio del 2026-10-01.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
