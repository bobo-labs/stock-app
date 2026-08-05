import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import './astryx-overrides.css'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { AstryxFoundation } from './astryx.js'

export default function AstryxDeleteDialog({ language, mode, ...props }) {
  return <AstryxFoundation language={language} mode={mode}><AlertDialog {...props} /></AstryxFoundation>
}
