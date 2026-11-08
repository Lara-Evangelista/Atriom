import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './i18n.js'
import { CosmeticsProvider } from './contexts/CosmeticsProvider'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CosmeticsProvider>
      <App />
    </CosmeticsProvider>
  </React.StrictMode>,
)
