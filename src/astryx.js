import { createElement } from 'react'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'

const spanishMessages = {
  '@astryx.alertDialog.cancel': {
    defaultMessage: 'Cancelar',
    description: 'Acción para cerrar una confirmación sin continuar.',
  },
}

export function AstryxFoundation({ language, mode, children }) {
  return createElement(
    InternationalizationProvider,
    { locale: language, messages: { es: spanishMessages } },
    createElement('div', {
      className: 'bakery-astryx',
      'data-astryx-theme': 'neutral',
      'data-theme': mode,
    }, children),
  )
}
