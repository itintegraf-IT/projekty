import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Polyfill pro window.storage (použije localStorage v prohlížeči)
if (!window.storage) {
  window.storage = {
    get: async (key) => ({ value: localStorage.getItem(key) }),
    set: async (key, val) => { localStorage.setItem(key, val); },
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
