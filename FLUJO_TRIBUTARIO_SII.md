# Flujo tributario SII para Bakery POS

## Objetivo

Integrar Bakery POS con el Servicio de Impuestos Internos (SII) para que el sistema pueda emitir documentos tributarios válidos, conservar su estado y entregar una representación impresa mediante el terminal Point.

> Este documento describe una arquitectura propuesta. El comprobante personalizado actual de Bakery POS es un piloto y todavía no constituye una boleta electrónica válida.

## Distinción fundamental

El sistema debe mantener separados estos tres conceptos:

1. **Venta:** productos, cantidades, precios, descuentos, impuestos y total.
2. **Pago:** efectivo, tarjeta, Mercado Pago Point u otro medio; además de su aprobación, rechazo o reembolso.
3. **Documento tributario:** boleta electrónica, nota de crédito u otro DTE emitido ante el SII.

Un pago aprobado no es necesariamente una boleta creada por Bakery POS. Del mismo modo, una devolución de dinero no sustituye automáticamente una nota de crédito.

## Flujo correcto para una boleta electrónica

Bakery POS no enviaría al SII una imagen, un PDF ni el comprobante térmico. El flujo sería:

1. El cajero confirma la venta.
2. El sistema registra sus productos, precios, IVA, total y medio de pago.
3. El módulo tributario determina si corresponde emitir una boleta electrónica.
4. Obtiene un folio autorizado y genera el documento tributario en XML según el formato del SII.
5. Firma electrónicamente el XML con el certificado digital correspondiente al contribuyente.
6. Envía el documento al SII y guarda su identificador de seguimiento y respuesta.
7. Genera la representación impresa o digital desde los mismos datos tributarios.
8. Bakery POS envía esa representación al Point mediante la API de impresión personalizada.

```text
Venta confirmada
       |
Registrar venta y pago
       |
Determinar tratamiento tributario
       |
Generar XML + folio + firma electrónica
       |
Enviar al SII y guardar respuesta
       |
Generar representación del documento
       |
Imprimir en Point y/o enviar al cliente
```

La representación impresa es el resultado visible del documento tributario; no es el documento que se envía al SII.

## Tratamiento según el medio de pago

### Pago en efectivo o transferencia

En términos generales, Bakery POS debería generar una boleta electrónica, enviarla al SII y entregar su representación impresa o digital.

### Pago con tarjeta o Mercado Pago Point

El comprobante de pago electrónico puede tener validez como boleta y reemplazar su emisión. La entidad procesadora informa esas operaciones al SII. Por ello, no se debe generar automáticamente una segunda boleta para la misma venta sin definir antes el régimen operativo aplicable.

Emitir simultáneamente el voucher válido como boleta y una boleta electrónica por la misma operación podría duplicar la venta tributaria. Bakery POS debe contar con una regla explícita para decidir cuál documento corresponde.

Nuestro comprobante Atelier puede seguir imprimiéndose como recibo detallado complementario, pero no tendrá validez tributaria mientras no sea la representación de un documento electrónico válido.

## Impresión operativa en Bakery POS

La impresión personalizada se controlará desde Bakery POS y no desde el botón nativo de Mercado Pago:

- Al aprobarse un cobro Point, Bakery POS envía automáticamente el comprobante personalizado al terminal.
- La sección **Actividad** conserva el historial de ventas Point y permite imprimir o reimprimir cada comprobante.
- Cada impresión o reimpresión crea una nueva acción de impresión enviada por Bakery POS al Point.
- El botón nativo de impresión del terminal seguirá generando el voucher propio de Mercado Pago y no puede reemplazarse mediante la API pública.

De esta forma, el comprobante personalizado siempre nace en nuestro sistema y el Point actúa como impresora térmica remota.

## Devoluciones y anulaciones

La devolución comercial, el reembolso del pago y la corrección tributaria también deben tratarse por separado:

1. Bakery POS registra qué productos y montos se devuelven.
2. Mercado Pago procesa el reembolso al medio de pago original cuando corresponda.
3. El inventario se repone solamente si el cajero lo confirma.
4. Si Bakery POS había emitido una boleta electrónica, el módulo tributario debe generar la nota de crédito electrónica correspondiente y referenciar el folio original.
5. El sistema conserva la relación entre venta, pago, reembolso, boleta y nota de crédito.

Reembolsar el dinero en Mercado Pago no reemplaza por sí solo la nota de crédito exigida cuando existe una boleta electrónica emitida por nuestro sistema.

## Datos que deberá conservar Bakery POS

Como mínimo:

- Identificador interno de la venta.
- Productos, cantidades, precios, descuentos, IVA y total.
- Medio y estado del pago.
- Identificador de la operación de Mercado Pago.
- Tipo de documento tributario y folio.
- XML original firmado.
- Track ID, respuesta y estado informado por el SII.
- Fecha y hora de emisión y envío.
- Documento tributario original relacionado, para notas de crédito.
- Historial de impresiones, reintentos, anulaciones y reembolsos.

## Requisitos generales para una implementación real

- Contribuyente habilitado como emisor electrónico.
- Certificado digital vigente y protegido de forma segura.
- Folios autorizados por el SII.
- Generación y validación de XML conforme a los esquemas vigentes.
- Firma electrónica y timbre electrónico cuando corresponda.
- Integración con los servicios del SII y manejo de sus respuestas.
- Ambiente de certificación y pruebas antes de producción.
- Reintentos seguros, auditoría y prevención de documentos duplicados.
- Almacenamiento protegido de documentos, estados y credenciales.

## Arquitectura recomendada

```text
Bakery POS
  |-- Módulo de ventas e inventario
  |-- Módulo de pagos
  |     `-- Mercado Pago Point
  |-- Módulo tributario
  |     |-- Folios y documentos XML
  |     |-- Firma digital
  |     |-- Envío y consulta al SII
  |     `-- Notas de crédito
  `-- Módulo de representación e impresión
        |-- Comprobante detallado
        |-- Representación tributaria
        `-- Impresión personalizada en Point
```

Esta separación permite que un pago pueda aprobarse aunque el SII esté temporalmente indisponible, dejando el documento en una cola controlada de envío y reintento según las reglas y plazos aplicables.

## Próximos pasos sugeridos

1. Confirmar con el contador o representante legal cómo se tratan actualmente los pagos con Point y las boletas de la panadería.
2. Definir una matriz por medio de pago para impedir la doble emisión.
3. Diseñar las tablas de documentos tributarios, folios, envíos y notas de crédito.
4. Construir primero un simulador local de emisión, sin validez tributaria.
5. Implementar firma, XML y comunicación con el ambiente de certificación del SII.
6. Validar el flujo completo de venta, rechazo, contingencia, devolución y nota de crédito.
7. Habilitar producción únicamente después de completar las pruebas y autorizaciones correspondientes.

## Referencias oficiales

- [Comprobante electrónico como reemplazo de la boleta](https://www.sii.cl/portales/ticketporboleta/comercio.htm)
- [Información general sobre boletas electrónicas](https://www.sii.cl/destacados/boletas_electronicas/)
- [Obligación de enviar las boletas electrónicas al SII](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7671.htm)
- [Formato técnico de boletas electrónicas](https://www.sii.cl/factura_electronica/factura_mercado/formato_boletas_elec_202412.pdf)

## Conclusión

La integración es viable, pero el comprobante visual no se “pasa por el SII” para transformarlo en boleta. Bakery POS debe crear primero el documento tributario estructurado, firmado y enviado al SII; posteriormente genera e imprime su representación. Para pagos con Point será indispensable evitar la duplicación entre el voucher válido como boleta y una boleta electrónica adicional.
