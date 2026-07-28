import { Component } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useI18n } from './i18n.js'

function RecoveryScreen() {
  const { t } = useI18n()
  return <main className="app-error-page">
    <section className="app-error-card">
      <div className="app-error-icon"><AlertTriangle size={28} /></div>
      <span className="eyebrow">Bakery POS</span>
      <h1>{t('somethingWentWrong')}</h1>
      <p>{t('unexpectedErrorDescription')}</p>
      <button className="button primary" onClick={() => window.location.reload()}>{t('reloadApp')}<RotateCw size={18} /></button>
    </section>
  </main>
}

export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('Bakery POS render failed:', error, info)
  }

  render() {
    return this.state.failed ? <RecoveryScreen /> : this.props.children
  }
}
