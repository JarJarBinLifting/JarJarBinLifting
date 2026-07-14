import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0f1c14', color: '#e8e2cd', fontFamily: 'Georgia, serif', textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div
              style={{
                width: 34,
                height: 34,
                margin: '0 auto 14px',
                border: '1.5px solid #c96a55',
                color: '#c96a55',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              !
            </div>
            <h1 style={{ fontSize: 18, marginBottom: 8 }}>Une erreur inattendue est survenue</h1>
            <p style={{ fontSize: 13, color: '#a9bfae', lineHeight: 1.6, marginBottom: 16 }}>
              Tes données sont enregistrées dans la base de données et n'ont pas été perdues. Recharge l'application pour continuer.
            </p>
            <p style={{ fontSize: 11, color: '#7c9081', fontFamily: 'monospace', marginBottom: 20, wordBreak: 'break-word' }}>{error.message}</p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '10px 20px', background: '#2f6b5e', color: '#fff', border: 'none', borderRadius: 2, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Recharger l'application
            </button>
          </div>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
