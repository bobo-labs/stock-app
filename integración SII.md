# Integración SII

> Estado: análisis y prompt de implementación futura. No implementa ni activa emisión tributaria.
>
> Investigación verificada: 2026-08-05.
>
> Alcance: Atelier del Puerto / `stock-app`, boletas electrónicas de ventas y servicios. No confundir con boletas de honorarios.

## 1. Dictamen ejecutivo

Sí, es técnicamente posible conectar `stock-app` directamente con el SII y dejar de pagar el servicio de boletas de Mercado Pago. El SII publica una API para recibir y consultar boletas electrónicas y no documenta una tarifa mensual ni por DTE para el acceso directo.

Sin embargo, hay tres precisiones decisivas:

1. La integración SII sólo reemplaza la **emisión tributaria**. No reemplaza Point Smart, el procesamiento de tarjetas, las comisiones, la Orders API, los webhooks ni los reembolsos de Mercado Pago.
2. Para pagos con tarjeta o QR, el voucher de un operador autorizado puede ser la boleta. Si el contribuyente declaró ante el SII el modelo **"No emito boleta cuando recibo un pago electrónico"**, no se debe emitir además una boleta tipo 39 para esa misma venta. Efectivo y transferencia siempre requieren boleta electrónica.
3. Para un solo comercio y un solo RUT, desarrollar una solución propia únicamente para ahorrar `$11.000 + IVA/mes` no es económicamente conveniente. El desarrollo directo se justifica por automatización, control, independencia de proveedor o reutilización futura en varios comercios.

### Recomendación para Atelier

La ruta recomendada es híbrida:

- Mantener Mercado Pago exclusivamente como medio de pago para tarjetas y QR.
- Declarar y confirmar en el SII el modelo en que el voucher reemplaza la boleta para pagos electrónicos.
- Emitir boleta tipo 39 sólo para efectivo, transferencias y otros medios no cubiertos por el voucher.
- Mientras no exista integración propia, usar gratuitamente la web o aplicación e-Boleta del SII para esas ventas.
- Construir la integración directa sólo si la emisión manual se vuelve un problema operacional o si `stock-app` se convertirá en un producto para más comercios.

Esta recomendación debe ser validada con el contador y con la situación real del RUT en el SII antes de cancelar cualquier servicio.

## 2. Qué mensualidad se puede evitar

La página pública de Mercado Pago indica, a la fecha de este análisis:

| Servicio | Precio publicado después de 6 meses gratis |
| --- | ---: |
| Boletas | `$11.000 + IVA/mes` o `$105.600 + IVA/año` |
| Boletas y facturas | `$38.000 + IVA/mes` o `$364.800 + IVA/año` |

Mercado Pago también declara que:

- el comprobante de tarjeta, débito o QR es válido como boleta y esas ventas son informadas al SII;
- el servicio adicional de boletas permite incluir efectivo;
- el modelo de emisión debe configurarse correctamente para no duplicar ventas.

Por lo tanto, el ahorro posible corresponde al complemento de boletas, no al servicio de cobro con Point.

Fuente: [Mercado Pago Point Smart 2](https://www.mercadopago.cl/herramientas-para-vender/lectores-point/point-smart-2).

## 3. Decisión tributaria que debe tomarse primero

Todos los contribuyentes deben declarar ante el SII cómo combinarán boleta electrónica y voucher. Esa declaración rige desde que se realiza y sólo puede cambiarse una vez al día.

| Medio de pago | Modelo "No emito boleta con pago electrónico" | Modelo "Siempre emito boleta" |
| --- | --- | --- |
| Efectivo | DTE 39 o 41, según corresponda | DTE 39 o 41, según corresponda |
| Transferencia bancaria | DTE 39 o 41, según corresponda | DTE 39 o 41, según corresponda |
| Tarjeta o QR con operador autorizado | Voucher; no emitir otro DTE por la misma venta | Voucher y DTE 39/41, bajo el modelo declarado |
| Pago mixto | Definir una regla contable antes de soportarlo; la aplicación actual no lo modela | Definir una regla contable antes de soportarlo |

Reglas para el diseño:

- No inferir el modelo a partir del método de pago: guardarlo como configuración del emisor y registrar una copia inmutable de la política aplicada en cada venta.
- No emitir tipo 41 sólo porque exista soporte técnico. Un contador debe confirmar que el giro y la operación son exentos.
- Para una venta respaldada únicamente por voucher no existe un folio DTE 39 propio al cual referenciar una nota de crédito. Un reembolso de Mercado Pago y una corrección tributaria son procesos distintos; el procedimiento exacto debe validarse con SII, Mercado Pago y el contador.
- Para una boleta propia 39/41 aceptada, una anulación o corrección posterior se realiza mediante DTE 61. No se debe marcar una nota de crédito como emitida sólo porque el dinero fue reembolsado.

Fuente principal: [SII, "Tu Voucher es tu Boleta"](https://www.sii.cl/destacados/boleta_electronica_voucher/index.html).

## 4. Comparación económica y operativa

Precios revisados el 2026-08-05. Pueden cambiar y deben volver a verificarse antes de contratar o cancelar.

| Alternativa | Costo publicado | Automatiza efectivo/transferencia | Carga técnica | Recomendación |
| --- | --- | --- | --- | --- |
| Voucher MP + e-Boleta SII manual | Sin mensualidad de emisión | No | Baja | Mejor alternativa inmediata si el volumen manual es tolerable |
| Mercado Pago Boletas | `$105.600 + IVA/año` pagando anual | Sí | Muy baja | Mejor servicio administrado para un solo RUT |
| SimpleAPI DTE Básico | `5 UF + IVA/año`, más certificado; primer año gratuito con 500 consultas/mes | Sí | Media | Acelera integración, pero no elimina costo recurrente |
| Facto con boleta + API | Desde aproximadamente `$435.000 + IVA/año`, según planes publicados | Sí | Baja/media | Más caro para este caso; aporta ERP y operación administrada |
| Integración directa SII | Sin tarifa SII documentada por llamada/DTE | Sí | Alta | Sólo por valor estratégico o reutilización |

Notas:

- SimpleAPI publica un plan gratuito por 12 meses y 500 consultas mensuales. Una consulta no equivale necesariamente a una boleta: generar, enviar y consultar estado pueden ser operaciones separadas. El plan Básico publicado es de 5 UF + IVA al año y 10.000 consultas mensuales.
- SimpleAPI abstrae XML, firma y envío, pero introduce una API propietaria y el manejo de certificado/clave a través de su infraestructura. Debe existir una evaluación contractual y de seguridad antes de enviar un PFX.
- Facto ofrece facturación básica gratuita, pero la boleta es una prestación pagada. La API es un complemento adicional; usar Facto gratis para "certificarse y salir" no es una estrategia suficiente ni documenta por sí sola un cambio de proveedor seguro.
- La integración directa sigue teniendo costos de certificado digital, ingeniería, certificación, hosting, almacenamiento, monitoreo, soporte y mantenimiento normativo.

Fuentes: [SimpleAPI precios](https://www.simpleapi.cl/Precios), [SimpleAPI certificación](https://www.simpleapi.cl/Certificacion), [Facto precios](https://facto.cl/precios/) y [ayuda de activación Facto](https://ayuda.facto.cl/cu%C3%A1les-son-los-pasos-para-operar-con-facto).

## 5. Qué ofrece realmente la API oficial

La especificación oficial disponible en [OpenAPI 1.0.5](https://www4c.sii.cl/bolcoreinternetui/api/openapi.json) expone para boletas 39 y 41:

- `GET /boleta.electronica.semilla`
- `POST /boleta.electronica.token`
- `POST /boleta.electronica.envio`
- `GET /boleta.electronica.envio/{rut}-{dv}-{trackid}`
- `GET /boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`
- catálogos de estados, tipos, niveles y secciones.

Ambientes publicados por la propia especificación:

- certificación: `https://apicert.sii.cl/recursos/v1`; `pangal.sii.cl` figura como servidor temporal exclusivo para upload;
- producción: `https://api.sii.cl/recursos/v1`; `rahue.sii.cl` figura como servidor temporal exclusivo para upload.

La API no recibe un JSON comercial y no construye el DTE. El sistema propio debe:

1. Obtener un CAF y reservar un folio autorizado.
2. Construir el DTE XML en el orden exacto definido por el XSD vigente.
3. Generar y firmar el TED con la clave contenida en el CAF.
4. Firmar el DTE y el sobre XML con el certificado digital del firmante autorizado.
5. Validar localmente el XML contra el XSD antes de enviarlo.
6. Obtener una semilla, firmarla, canjearla por token y enviar el token en `Cookie: TOKEN=...`.
7. Subir `EnvioBOLETA` mediante `multipart/form-data`.
8. Guardar el Track ID y consultar hasta un estado final.
9. Tratar HTTP 200 como recepción técnica, no como aceptación tributaria.
10. Entregar al cliente la representación exigida y conservar el XML.

La OpenAPI indica que la semilla dura 2 minutos; el token mantiene una actividad de 1 hora y se renueva al usarlo. También recomienda lotes de 50 boletas y esperar aproximadamente 10 minutos antes de consultar, aunque el formato permite hasta 500 boletas por sobre.

El token todavía exige XMLDSIG con C14N 2001, RSA-SHA1, transformación enveloped y digest SHA1. Es una excepción de compatibilidad requerida por el SII: no habilita desactivar TLS ni usar SHA1 fuera del protocolo exacto.

### DTE 61 no usa esta misma superficie REST

La OpenAPI de boletas cubre 39 y 41. La nota de crédito 61 pertenece al flujo general de DTE y requiere su propio formato, certificación y transporte SII. No se debe asumir que `POST /boleta.electronica.envio` acepta notas de crédito.

Antes de producción debe cumplirse una de estas condiciones:

- tipo 61 automático certificado y probado de extremo a extremo; o
- procedimiento manual oficial, probado y asignado a un responsable, para cada corrección/anulación, sin afirmar en la aplicación que fue emitido hasta registrar su folio y estado real.

## 6. Normativa y requisitos vigentes que cambian el diseño

### Envío y conservación

- Cada boleta debe enviarse inmediatamente, con plazo máximo de una hora. Si no existe cobertura, el plazo se cuenta desde el restablecimiento de la conexión.
- Cada folio autorizado se usa una sola vez.
- Los XML deben conservarse al menos seis años.
- El emisor debe mantener consulta en línea en la sucursal para el mes actual y los dos anteriores, y poner la boleta a disposición del cliente durante tres meses según el formato/instructivo aplicable.

Fuente: [Resolución Ex. SII N° 74 de 2020](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf) y [formato de boleta v4.2, 2025-09-08](https://www.sii.cl/factura_electronica/factura_mercado/formato_boleta_electronica.pdf).

### RVD/RCOF: obligación eliminada en producción

El Resumen de Ventas Diarias, antes Reporte de Consumo de Folios, dejó de ser obligatorio para operaciones desde el 1 de agosto de 2022, para todos los sistemas. El Registro de Compras y Ventas se alimenta de las boletas recibidas por el SII.

Hay páginas antiguas, instructivos y librerías que aún dicen que debe enviarse diariamente. Incluso el proceso de certificación puede solicitar un RCF como artefacto de prueba. La regla de implementación será:

- no crear un job productivo diario de RVD;
- conservar soporte de certificación/legado sólo si el set vigente asignado por el SII lo exige;
- resolver cualquier contradicción mediante la Resolución Ex. SII N° 53 de 2022 y una confirmación escrita del SII.

Fuente: [FAQ SII actualizada el 2026-07-20](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7679.htm) y [Resolución Ex. SII N° 53 de 2022](https://www.sii.cl/normativa_legislacion/resoluciones/2022/reso53.pdf).

Esta conclusión corrige la afirmación sobre un resumen diario que aparece actualmente en `SII_DTE_RESEARCH.md` y `ROADMAP.md` del repositorio. Esos documentos no deben usarse como fuente normativa sin esta corrección.

### Entrega al comprador

La Resolución Ex. SII N° 53 de 2025 exige entregar o poner a disposición la representación impresa o virtual de la boleta/voucher en ventas presenciales. Las obligaciones rigen desde el 1 de mayo de 2025 para dispositivos con impresión y desde el 1 de marzo de 2026 para otros dispositivos. Una entrega virtual puede utilizar, según el caso, correo, SMS, mensajería, fotografía, NFC o QR.

Desde el 1 de enero de 2026, la Resolución Ex. SII N° 207 de 2025 hizo opcional imprimir el timbre electrónico/PDF417 en la representación impresa. El TED continúa siendo obligatorio dentro del XML.

Fuentes: [Resolución Ex. SII N° 53 de 2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso53.pdf) y [Resolución Ex. SII N° 207 de 2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso207.pdf).

### Certificación

El sistema gratuito del SII no requiere certificar software, pero no ofrece integración con aplicaciones del contribuyente. Un sistema propio o de mercado debe completar la habilitación/certificación aplicable:

1. Postulación o acceso al ambiente de certificación por el representante legal.
2. Descarga del set de pruebas y CAF de certificación.
3. Construcción y envío de los XML exigidos.
4. Corrección hasta obtener recepción consistente con el set.
5. Muestras de representación y sitio de consulta cuando sean requeridos.
6. Declaración de cumplimiento.
7. Autorización para producción.

El SII indica un tiempo de revisión de 10 a 15 días hábiles para la revisión de boletas, no para todo el desarrollo. Una cuenta de certificación puede eliminarse tras seis meses sin actividad.

Fuentes: [guía vigente para certificar boletas](https://www.sii.cl/servicios_online/1039-guia_emitir_boleta_servicio-1184.html) y [proceso de certificación DTE](https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm).

### Migración desde otro sistema

- Cambiar de proveedor comercial no obliga necesariamente a postular o certificar todo nuevamente; el SII recomienda ejecutar pruebas en certificación.
- Pasar de software comercial a desarrollo propio no requiere una nueva postulación del contribuyente, pero sí probar/certificar los documentos o cambios que correspondan.
- Pasar desde el sistema gratuito de boletas del SII a uno propio o de mercado puede exigir una presentación mediante Formulario 2117 y una habilitación paralela.

La situación exacta de Atelier debe verificarse antes de diseñar el cronograma, porque no sabemos si el RUT está hoy inscrito mediante Mercado Pago, el sistema gratuito u otro proveedor.

Fuentes: [cambio de proveedor](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6485.htm), [cambio de comercial a propio](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6529.htm) y [cambio desde sistema gratuito](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7816.htm).

## 7. Evaluación de las fuentes entregadas

### `JavierAgueroCL/laravel-dte-api`

Conclusión: referencia histórica útil; no usar como base desplegable.

- Licencia MIT.
- Mapea varios DTE, CAF, envíos, estados, PDF y validación XSD.
- Usa Laravel 6/PHP 7.4, sin README, CI ni pruebas tributarias suficientes; los últimos cambios funcionales son de 2023.
- Guarda contraseña PFX como campo serializable y material privado en almacenamiento general.
- Un controlador de certificados puede exponer datos sin comprobar correctamente la pertenencia a la empresa.
- Desactiva verificación TLS al hablar con el SII.
- Su asignación de folios es lectura-modificación-escritura sin bloqueo ni unicidad, por lo que puede duplicar folios bajo concurrencia.

Uso permitido: estudiar el dominio y construir fixtures independientes. No copiar sus patrones de seguridad, transporte, autenticación o persistencia.

Repositorio: [laravel-dte-api](https://github.com/JavierAgueroCL/laravel-dte-api).

### `devlas-cl/dte-sii`

Conclusión: candidato técnico para un experimento controlado detrás de un adaptador; no dependencia confiable directa en producción.

- Es Node 18+, MIT y es el proyecto más cercano al stack actual.
- Incluye piezas para PFX, CAF, TED, XML, sobres, envío, consultas y certificación.
- Es muy reciente: comenzó en marzo de 2026, tiene un mantenedor, no tiene releases estables ni CI y las pruebas publicadas cubren principalmente extracción de RUT desde PFX.
- README, tipos TypeScript y API ejecutable no están completamente sincronizados.
- Deshabilita TLS globalmente y habilita renegociación insegura.
- Contiene RUT y contraseña PFX hardcodeados en una prueba.
- Persiste cookies del SII y folios en JSON; el registro de folios no es atómico ni multiproceso.
- El modo debug puede escribir XML y respuestas con información tributaria/personal.
- No hay evidencia reproducible en el repositorio de una certificación completa aceptada por el SII.
- Presenta el RVD como flujo productivo normal, lo que está obsoleto desde agosto de 2022.

Uso permitido: hacer un fork fijado a commit, ponerlo detrás de una interfaz propia, eliminar TLS inseguro y persistencia sensible, reemplazar el registro JSON por PostgreSQL y demostrar cada función contra XSD y certificación. La aplicación debe poder reemplazarlo sin cambiar el dominio.

Repositorio: [dte-sii](https://github.com/devlas-cl/dte-sii).

### `sebaiturravaldes/eboleta-sii`

Conclusión: no usar.

- Automatiza con Puppeteer el portal gratuito `eboleta.sii.cl` usando RUT y clave tributaria.
- No implementa DTE, CAF, firma ni la API oficial.
- Depende de selectores CSS y esperas fijas; no tiene idempotencia, reintentos, pruebas ni CI.
- Tiene cuatro commits y no incluye un archivo de licencia, aunque `package.json` declara ISC.
- El SII indica expresamente que su sistema gratuito no se integra con aplicaciones del contribuyente. Automatizar la interfaz es frágil y puede contradecir las condiciones del sitio.

Repositorio: [eboleta-sii](https://github.com/sebaiturravaldes/eboleta-sii).

### `FacTronica/BoletaHonorariosEmitir`

Conclusión: irrelevante para este proyecto y con patrones inseguros.

- Trata boletas de honorarios electrónicas, no boletas de ventas y servicios 39/41.
- No contiene motor: sólo un README comercial y ejemplos.
- El endpoint mostrado es un placeholder; no existe especificación, código verificable ni pruebas.
- El ejemplo usa HTTP, `curl -k` y envía clave SII/certificado/clave privada en el payload.
- No tiene licencia.

Repositorio: [BoletaHonorariosEmitir](https://github.com/FacTronica/BoletaHonorariosEmitir).

### Hilo de Reddit

Conclusión: útil como lista de tropiezos, no como fuente técnica, económica ni tributaria.

- El error `LSX-00204` confirma que orden de nodos, esquema, sobre y encoding son estrictos.
- La sugerencia de certificar gratis con Facto y luego "cambiar correos" simplifica una migración que requiere respaldo, folios, pruebas, coordinación y cierre del proveedor.
- El bloqueo relatado con RVD mezcla un artefacto que puede aparecer en certificación con una obligación productiva eliminada en 2022.
- Los relatos de éxito en JS/PHP no incluyen fixtures, Track ID, estados aceptados o pruebas reproducibles.

Hilo: [Certificación al SII mediante SimpleAPI](https://www.reddit.com/r/chileIT/comments/1pmhkuv/certificacion_al_sii_mediante_simpleapi/).

## 8. Encaje con la aplicación actual

`stock-app` ya tiene una buena base para integrar el dominio tributario:

- Node 20, Express 5 y PostgreSQL.
- Ventas en efectivo quedan pagadas dentro de una transacción.
- Ventas con tarjeta reservan inventario y sólo pasan a pagadas tras estado `processed/accredited` de Mercado Pago.
- Webhook y polling convergen sobre la misma venta.
- Reembolsos, reposición de inventario y notas de crédito ya son conceptos separados.

Gaps actuales:

- `tax_documents` sólo soporta `credit_note` y estados `pending/issued/failed`.
- No existe boleta 39/41, evidencia de voucher, snapshot de política tributaria ni vínculo genérico venta-DTE.
- No hay tabla de emisor, sucursal, certificado, CAF, rangos de folio, sobres, eventos o outbox.
- No hay worker duradero ni reconciliador SII.
- El modo JSON local no ofrece concurrencia ni durabilidad suficientes para folios de producción.
- No existe representación de boleta, entrega digital, consulta pública ni retención de XML.

El flujo de caja/tarjeta no debe reescribirse. La integración se agrega después del hecho de negocio `sale.paid` y conserva estados separados para pago, inventario y tributación.

## 9. Arquitectura objetivo

La primera versión debe ser un límite lógico dentro del repositorio y un proceso worker separado, compartiendo PostgreSQL. No hace falta introducir Redis ni un microservicio remoto mientras un outbox transaccional en PostgreSQL cubra el volumen.

```text
POS / webhook Mercado Pago
          |
          v
transacción PostgreSQL
  - venta pagada
  - snapshot de líneas/precios/impuestos
  - resolución de evidencia tributaria
  - evento tax_outbox si corresponde DTE
          |
          v
worker tributario aislado
  - reserva transaccional de folio/CAF
  - XML + TED + XMLDSIG + XSD
  - persistencia de XML y hash inmutables
          |                         |
          v                         v
representación y entrega       token y envío SII
  - inmediata al firmar            |
  - impresión/canal virtual         v
  - consulta y conservación     reconciliador SII
                                - recibido / aceptado / observado / rechazado
                                - retry con el mismo documento
                                - alerta y revisión manual
```

### Componentes

1. `TaxPolicyResolver`: decide `mp_voucher`, `sii_dte_39`, `sii_dte_41` o `manual_review` a partir de emisor, modelo declarado y medio de pago.
2. `TaxOutbox`: crea un trabajo en la misma transacción que deja la venta pagada.
3. `FolioAllocator`: importa CAF, verifica firma/rango/vigencia y reserva folios con bloqueo de fila y restricción única.
4. `DteBuilder`: crea un snapshot inmutable y genera XML determinista.
5. `DteSigner`: firma TED, DTE y sobre sin exponer claves.
6. `SiiBoletaGateway`: semilla, token, upload y consultas para 39/41.
7. `SiiDteGateway`: transporte separado para DTE 61 y otros DTE futuros.
8. `TaxReconciler`: consulta estados, clasifica respuestas y decide retry o revisión.
9. `ReceiptRenderer`: representación impresa/virtual construida desde el snapshot, nunca desde el catálogo mutable. No espera el estado final SII para representar un DTE localmente válido y firmado.
10. `ReceiptDelivery`: impresión, correo u otro canal autorizado con estados propios y un objetivo operacional de entrega inmediata.
11. `TaxAdmin`: estado de CAF/certificado, documentos rechazados, reintentos y acciones manuales auditadas.

### Tablas mínimas

Los nombres finales deben seguir las convenciones del repositorio, pero el modelo necesita al menos:

- `issuer_configs`: RUT, razón social, giro, ambiente, modelo voucher/boleta, zona horaria y configuración de sucursal.
- `issuer_signers`: metadatos del certificado, referencia cifrada, vigencia y estado; nunca PFX/clave en claro.
- `caf_ranges`: tipo DTE, rango, XML CAF cifrado, huella, siguiente candidato y estado.
- `folio_allocations`: emisor, tipo, folio, CAF, documento y timestamps; único por `(issuer_id, dte_type, folio)`.
- `tax_documents`: venta/reembolso, tipo 39/41/61, folio, snapshot, hash XML, Track ID y estado SII.
- `tax_document_events`: historial append-only de construcción, firma, envío, respuesta, consulta y acción manual.
- `tax_submissions`: sobre, hash, documentos incluidos, Track ID y respuestas sanitizadas.
- `tax_outbox`: idempotency key, intento, próximo intento, lease y error clasificado.
- `tax_deliveries`: canal, destinatario cifrado o minimizado, estado e intentos.
- `sale_tax_evidence`: `mp_voucher` o `sii_dte`, identificadores y snapshot de la política aplicada.

Restricciones mínimas:

- único `(issuer_id, dte_type, folio)`;
- único `idempotency_key` de emisión, por ejemplo `sale:{sale_id}:primary`;
- una evidencia tributaria primaria por venta bajo la política seleccionada;
- una nota de crédito no puede referenciar un documento inexistente o de otro emisor;
- montos y líneas del DTE se guardan como snapshot inmutable.

### Estados separados

No usar un único `issued` para todo el ciclo. Como mínimo:

- pago: `pending`, `paid`, `failed`, `refunded`;
- documento: `not_required`, `queued`, `folio_reserved`, `built`, `signed`, `submitted`, `received`, `accepted`, `accepted_with_observations`, `rejected`, `retryable`, `manual_review`;
- entrega: `pending`, `printed`, `sent`, `failed`;
- reembolso: estado de Mercado Pago o caja;
- nota de crédito: ciclo DTE independiente.

## 10. Reglas de consistencia e idempotencia

1. Sólo una venta final pagada puede producir evidencia tributaria.
2. Efectivo: venta, snapshot tributario y outbox se crean en la misma transacción PostgreSQL.
3. Tarjeta: el webhook/polling sólo crea evidencia después de `processed + accredited`.
4. En modo voucher, tarjeta/QR registra el voucher de Mercado Pago y no encola DTE 39/41.
5. En modo siempre-boleta, tarjeta/QR encola DTE sólo después de pago y conserva también el voucher.
6. Worker y webhook pueden ejecutarse varias veces sin crear un segundo documento.
7. La reserva del folio ocurre dentro de una transacción con `SELECT ... FOR UPDATE` o bloqueo equivalente.
8. Un folio reservado nunca vuelve al pool por un timeout o rechazo.
9. Después de firmar, XML, identidad `(RUT, tipo, folio)` y hash son inmutables.
10. Si el upload tiene resultado incierto, consultar estado y reenviar exactamente el mismo XML según la política documentada; nunca asignar otro folio a ciegas.
11. HTTP 200 y Track ID no significan aceptación.
12. Los retries usan backoff con jitter, límite temporal y paso a revisión manual.
13. Alertar con margen antes del máximo de una hora, agotamiento de CAF y vencimiento del certificado.
14. Reconciliar periódicamente documentos locales, estados SII y Registro de Compras y Ventas.
15. Generar y poner a disposición la representación inmediatamente después de obtener el DTE firmado; no esperar la consulta final SII. Si la generación local falla, el POS debe mostrar una contingencia explícita y alertar al responsable, nunca ocultar el problema.

## 11. Seguridad no negociable

- El PFX, su contraseña, la clave privada del certificado y la clave privada del CAF nunca llegan al navegador.
- No almacenar secretos en Git, logs, JSON local, snapshots de error ni columnas en claro.
- Cifrar material en reposo con una clave separada de la base de datos; descifrar sólo en memoria del worker durante el menor tiempo posible.
- Mantener validación TLS. Prohibido `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`, `curl -k` o equivalentes.
- No usar RUT y clave tributaria para automatizar el portal web.
- Sanitizar XML/respuestas en logs; los artefactos completos van a almacenamiento cifrado con control de acceso y retención definida.
- Validar pertenencia de emisor en cada consulta y mutación. Si algún día hay varios RUT, toda tabla y clave debe estar aislada por `organization_id`/`issuer_id`.
- Verificar vigencia, RUT y cadena del certificado antes de firmar; alertar a 60, 30, 15 y 7 días del vencimiento.
- Auditar carga/reemplazo de certificado, importación/anulación de CAF, retry manual, cambio de estado y descarga de XML.
- Fijar versiones/commits de librerías tributarias y someter cambios a fixtures y certificación antes de actualizar.

## 12. Plan futuro por fases

### Fase 0: auditoría tributaria y decisión de producto

No escribir integración productiva hasta responder y respaldar:

- RUT y razón social exactos del emisor.
- Estado actual: sistema gratuito, Mercado Pago, otro proveedor o desarrollo propio.
- Resoluciones/autorizaciones y tipos DTE habilitados.
- Modelo voucher/boleta declarado hoy.
- Fecha de término de los seis meses y condiciones de cancelación/exportación de Mercado Pago.
- Volumen diario/mensual por efectivo, transferencia, tarjeta y QR.
- Existencia de operaciones exentas y validación de tipo 41.
- Firmantes autorizados y certificado digital vigente.
- Sucursales, códigos SII, cajas y direcciones de origen.
- CAF existentes, folios usados/no usados y quién los controla.
- Proceso actual para anulaciones, cambios, devoluciones y notas de crédito.
- Impresora disponible y canales aceptados para entrega virtual.
- Intención real: un RUT o plataforma multiempresa.

Entregable: acta de decisión firmada por dueño/contador que seleccione una de estas políticas:

- A: voucher + e-Boleta SII manual;
- B: voucher + DTE propio sólo para efectivo/transferencia, recomendada para automatización;
- C: DTE propio para todos los medios bajo "Siempre emito boleta";
- D: conservar proveedor administrado.

Gate: no avanzar si el modelo declarado y las autorizaciones no son verificables.

### Fase 1: spike técnico en certificación

- Crear una interfaz interna independiente de proveedor.
- Evaluar un fork de `dte-sii` fijado a commit versus implementación mínima desde esquemas oficiales.
- Corregir TLS, secretos, logs y registro de folios antes de ejecutar la librería.
- Importar sólo CAF de certificación.
- Construir una boleta 39 mínima y otra con varias líneas, acentos, descuentos y redondeos.
- Validar XSD, TED y todas las firmas con verificadores independientes.
- Obtener semilla/token, enviar a certificación y llegar a estado final aceptado.
- Guardar fixtures sin secretos y respuestas sanitizadas.

Gate: evidencia reproducible de aceptación en certificación, sin desactivar seguridad.

### Fase 2: motor durable y certificación completa

- Añadir migraciones PostgreSQL, outbox, folios transaccionales y estados append-only.
- Implementar 39; implementar 41 sólo si está autorizado y realmente se necesita.
- Resolver 61 mediante el flujo DTE general o probar una alternativa manual oficial.
- Completar el set vigente, incluyendo RCF sólo si el set de certificación lo pide.
- Crear representaciones, entrega y página de consulta conforme a requisitos asignados.
- Completar muestras, revisión y declaración de cumplimiento.

Gate: autorización SII y camino probado para correcciones/anulaciones.

### Fase 3: integración con `stock-app`

- Conectar el outbox al momento exacto en que `sales.status` pasa a `paid`.
- Registrar voucher como evidencia para ventas electrónicas bajo el modelo híbrido.
- Añadir UI operativa que no espere la aceptación final del SII, pero sí mantenga visible el flujo hasta entregar la representación firmada o activar una contingencia explícita.
- Añadir entrega impresa/virtual y reenvío.
- Incorporar alertas por una hora, certificado, CAF, rechazo y cola detenida.
- Mantener el modo JSON exclusivamente para demo; impedir emisión SII real sin PostgreSQL.

Gate: suite completa, simulacro de caída SII y reconciliación contable aprobada.

### Fase 4: migración controlada

- Exportar y respaldar XML, reportes, folios y estados del proveedor anterior antes de cancelar.
- Probar en certificación sin emitir duplicados en producción.
- Solicitar un rango CAF nuevo para el sistema propio o reconciliar formalmente cualquier rango existente.
- No permitir que dos sistemas asignen folios del mismo rango.
- Definir fecha/hora de corte, último documento del sistema anterior y primer documento propio.
- Actualizar modelo de emisión, proveedor, correos y usuarios en SII cuando corresponda.
- Detener/revocar Mercado Pago Boletas sólo después de verificar el primer ciclo propio.
- Reconciliar diariamente durante las primeras semanas: ventas, vouchers, DTE, notas, Track ID y RCV.
- Mantener un plan de reversión operativo; nunca "revertir" reutilizando folios ya asignados.

Gate: conciliación sin omisiones ni duplicidad y aceptación del contador.

## 13. Matriz mínima de pruebas

### Unitarias

- RUT/DV, fechas y zona horaria `America/Santiago`.
- Cálculo neto, IVA, total y redondeo en CLP.
- Líneas, descuentos, recargos y caracteres acentuados.
- DTE 39 y, si aplica, 41.
- TED y XMLDSIG con fixtures verificables.
- XSD vigente y orden estricto de elementos.
- CAF válido, fuera de rango, agotado, duplicado y corrupto.
- Certificado correcto, expirado, RUT incorrecto y contraseña errónea.
- Clasificación de todos los estados y errores SII conocidos.

### Concurrencia e idempotencia

- Múltiples workers reservan folios distintos.
- Webhook duplicado no crea dos DTE.
- Polling y webhook simultáneos convergen.
- Timeout después de upload no asigna otro folio.
- Reinicio entre reserva, firma, upload y consulta recupera el mismo trabajo.
- Reintento manual no modifica el XML ya firmado.

### Integración

- Semilla expirada y token expirado.
- Respuesta HTTP 200 seguida de rechazo tributario.
- Sobre aceptado con un documento rechazado.
- SII lento/no disponible por más de un intento.
- Certificación para 39 y flujo 61.
- Entrega impresa y virtual.

### Negocio

- Efectivo genera exactamente una boleta.
- Transferencia genera exactamente una boleta.
- Tarjeta bajo modelo voucher no genera DTE.
- Tarjeta bajo modelo siempre-boleta genera exactamente un DTE después de acreditarse.
- Pago fallido/cancelado no genera evidencia de venta.
- Reembolso de voucher no inventa un folio DTE.
- Devolución de boleta propia crea o exige nota 61 sin alterar inventario dos veces.
- Reportes separan ventas, reembolsos, vouchers y DTE sin duplicar ingresos.

### Seguridad

- Ningún secreto o XML completo aparece en logs y respuestas API.
- TLS inválido falla de forma cerrada.
- Un emisor no accede a certificados, CAF, folios o documentos de otro.
- Backups cifrados se restauran y conservan la trazabilidad.

## 14. Criterios de no salida a producción

No desplegar si ocurre cualquiera de estos puntos:

- modelo voucher/boleta no confirmado en el SII;
- ausencia de autorización/certificación aplicable;
- certificado o CAF almacenados en claro;
- validación TLS desactivada;
- folios gestionados en archivo JSON o sin restricción única;
- un único estado ambiguo `issued` que confunda documento generado, enviado y aceptado, o cualquier mensaje que afirme aceptación SII antes de verificarla;
- no existe solución probada para nota 61 o procedimiento manual oficial;
- no existe entrega al comprador;
- no hay alertas para el plazo de una hora, CAF y certificado;
- no hay reconciliación con Mercado Pago y RCV;
- dos emisores pueden operar el mismo rango de folios;
- sólo se ha probado el camino feliz.

## 15. Prompt maestro para una implementación futura

El siguiente bloque está pensado para entregarse a Codex cuando se decida comenzar. Debe acompañarse con las respuestas de Fase 0 y acceso al ambiente de certificación, nunca con secretos escritos en el chat o en Git.

```text
Actúa como arquitecto y desarrollador senior responsable de implementar una integración tributaria chilena en el repositorio stock-app. Lee primero por completo el archivo "integración SII.md" y usa sus conclusiones como restricciones de diseño. No asumas que una API HTTP exitosa equivale a un DTE aceptado.

OBJETIVO

Integrar stock-app con el SII para emitir, enviar, reconciliar, conservar y entregar boletas electrónicas propias, evitando la suscripción de emisión de Mercado Pago sin dejar de usar Mercado Pago Point para procesar tarjetas. La primera política preferida es híbrida: voucher para tarjeta/QR y DTE 39 propio para efectivo/transferencias. Esta política sólo se puede activar si coincide con el modelo declarado por el contribuyente ante el SII.

ALCANCE INICIAL

- Un emisor/RUT y una sucursal, pero sin decisiones que impidan aislamiento multi-RUT futuro.
- DTE 39 como documento principal.
- DTE 41 sólo si Fase 0 demuestra operaciones exentas y autorización.
- DTE 61 automático o un fallback manual oficial y probado antes de producción.
- Ambientes de certificación y producción totalmente separados.
- PostgreSQL obligatorio en producción.
- Proceso worker separado del servidor web, usando outbox PostgreSQL.
- Representación impresa/virtual, consulta, retención y auditoría.

FUERA DE ALCANCE

- Reemplazar Mercado Pago como adquirente o procesador de pagos.
- Automatizar el portal SII con Puppeteer, RUT y clave tributaria.
- Boletas de honorarios.
- Factura 33 y otros DTE no aprobados expresamente.
- RVD productivo diario; sólo artefacto de certificación/legado si el set vigente lo exige.
- SaaS multiempresa en la primera salida.

PRECONDICIONES: DETENTE Y ENTREGA UN INFORME DE FASE 0 SI FALTA ALGUNA

1. Identidad y situación tributaria del emisor verificadas.
2. Modelo voucher/boleta actual confirmado mediante evidencia del SII.
3. Sistema/proveedor actual y procedimiento de migración confirmados.
4. Tipos DTE autorizados y set de certificación vigente disponibles.
5. Firmante autorizado y certificado digital vigente disponibles mediante un canal seguro.
6. CAF de certificación disponible; no usar CAF productivo durante desarrollo.
7. Sucursales/códigos SII, giro, dirección y datos del emisor validados.
8. Regla contable para devoluciones y notas de crédito aprobada por contador.
9. Canal de entrega al comprador decidido.
10. Responsable operacional para alertas y revisión manual asignado.

FUENTES Y CRITERIO DE AUTORIDAD

- Usa primero resoluciones, XSD, formatos, OpenAPI y guías oficiales vigentes del SII.
- Verifica nuevamente versiones y fechas antes de programar; hoy el formato de boleta conocido es v4.2 de 2025-09-08 y la OpenAPI es 1.0.5.
- Si una FAQ, instructivo antiguo, repo o set contradice una resolución posterior, documenta la contradicción y pide confirmación escrita al SII para el set específico.
- Los repos laravel-dte-api y dte-sii son referencias, no fuente normativa.
- eboleta-sii y BoletaHonorariosEmitir no pueden ser dependencias ni inspiración de seguridad.

PRIMERA ENTREGA: DISEÑO ANTES DE CÓDIGO

1. Inspecciona el worktree y preserva todos los cambios existentes del usuario.
2. Describe el flujo actual de efectivo, Point, webhook, polling, inventario, refunds y tax_documents con referencias de archivo/línea.
3. Entrega una matriz payment_method x modelo_de_emisión -> evidencia tributaria.
4. Propón migraciones compatibles y reversibles, sin borrar datos actuales.
5. Define interfaces para TaxPolicyResolver, DteEngine, SiiBoletaGateway, SiiDteGateway, FolioAllocator, TaxReconciler, ReceiptRenderer y SecretStore.
6. Define estados, transiciones, invariantes, idempotency keys y restricciones SQL.
7. Define el modelo de amenazas para PFX, contraseña, CAF, tokens, XML y datos del receptor.
8. Define la estrategia de certificación, migración, observabilidad, respaldo y reversión.
9. Presenta el plan en fases con gates verificables. No escribas código productivo hasta aprobar esta entrega.

IMPLEMENTACIÓN TÉCNICA OBLIGATORIA

- Agrega el evento tributario en la misma transacción que confirma la venta pagada.
- No bloquees el cobro esperando la red o aceptación final del SII. Después del pago, mantén la confirmación operativa hasta disponer de la representación firmada o registrar una contingencia explícita.
- Usa PostgreSQL como cola durable y reserva folios con bloqueo transaccional.
- Impón UNIQUE(issuer_id, dte_type, folio) y UNIQUE(idempotency_key).
- Guarda un snapshot inmutable de emisor, receptor, líneas, cantidades, precios, descuentos, impuestos, total, medio de pago y política tributaria.
- Genera XML determinista, valida XSD antes de firmar/enviar y conserva un hash criptográfico.
- Firma TED con CAF y DTE/sobre con el certificado autorizado según el protocolo oficial exacto.
- Mantén TLS validado. Elimina cualquier rejectUnauthorized=false, NODE_TLS_REJECT_UNAUTHORIZED=0, curl -k o renegociación insegura.
- Cifra PFX, contraseña y CAF en reposo con una clave externa a PostgreSQL. Nunca los registres ni los expongas al frontend.
- Reutiliza token SII dentro de su vigencia de forma segura y renuévalo cuando corresponda.
- Separa recibido, aceptado, observado y rechazado. HTTP 200 o Track ID no son estado final.
- Ante resultado incierto, consulta/reintenta el mismo XML y folio; jamás reserves otro folio automáticamente.
- Implementa backoff con jitter, clasificación de errores, dead-letter/manual_review y alertas antes de una hora.
- Conserva XML firmado y eventos durante el plazo aplicable; minimiza datos en logs.
- Genera la representación desde el snapshot inmutable inmediatamente después de firmar, sin esperar aceptación final, y registra la entrega impresa/virtual por separado.
- Implementa la consulta de boleta conforme al requisito de certificación sin crear un endpoint público fácilmente enumerable ni filtrar datos personales.
- Trata DTE 61 mediante el gateway DTE general; no lo envíes por la API REST de boletas 39/41 sin evidencia oficial.

REGLAS DE MERCADO PAGO

- Bajo modelo voucher, una venta card/QR acreditada registra mp_voucher y NO encola 39/41.
- Bajo modelo siempre-boleta, sólo encola después de processed/accredited y conserva el voucher como evidencia adicional.
- Un pago pending, failed, cancelled o expired no emite DTE de venta.
- Un refund de Mercado Pago no implica nota 61 automática si la evidencia original fue sólo voucher.
- Pago, inventario, tributación y entrega son máquinas de estado separadas y reconciliables.

USO EVENTUAL DE dte-sii

- Evalúalo únicamente en un fork fijado a un commit y detrás de nuestras interfaces.
- Antes de ejecutarlo elimina TLS inseguro, cookies/folios JSON, secretos hardcodeados y logs XML por defecto.
- No confíes en README o tipos; prueba la API ejecutable.
- Sustituye FolioRegistry por PostgreSQL.
- Crea fixtures propios y verifica firmas/XSD de manera independiente.
- Si el costo de sanearlo supera el valor reutilizable, implementa el núcleo mínimo desde los XSD oficiales.

PRUEBAS Y EVIDENCIA

- Añade pruebas unitarias de cálculo CLP/IVA, encoding, orden XML, XSD, TED, XMLDSIG, CAF y certificados.
- Añade pruebas de concurrencia real de folios y de duplicación webhook/polling.
- Añade fault injection en cada frontera: después de reservar, firmar, enviar y recibir Track ID.
- Añade integración en ambiente SII de certificación con estados finales verificables.
- Añade pruebas de política voucher para impedir doble emisión.
- Añade pruebas de refunds/notas 61 e independencia de inventario.
- Añade pruebas de no filtración de secretos, TLS fail-closed y aislamiento por emisor.
- Conserva evidencia sanitizada de casos aceptados/rechazados y el set exacto usado.

MIGRACIÓN Y CUTOVER

- No hagas shadow traffic que envíe DTE productivos duplicados; usa generación local o certificación.
- Exporta y respalda documentos/datos del proveedor anterior antes de la baja.
- Preferir un CAF/rango nuevo para el sistema propio; cualquier rango legado debe reconciliarse y quedar bajo un único asignador.
- Registra explícitamente último folio anterior y primero propio.
- Coordina modelo SII, proveedor y baja de Mercado Pago Boletas en una ventana controlada.
- Verifica los primeros documentos aceptados y su RCV antes de considerar completado el corte.
- Documenta runbooks para SII caído, token, rechazo, CAF agotado, certificado vencido, cola detenida, duplicidad sospechada y rollback operativo.

DEFINITION OF DONE

- Autorización/certificación aplicable confirmada.
- Ninguna emisión doble en efectivo, tarjeta, webhook duplicado o retry.
- Ningún folio duplicado bajo concurrencia o reinicio.
- Todos los estados SII terminales quedan reconciliados y auditables.
- Plazo máximo de envío monitorizado con alertas.
- Certificado/CAF cifrados y TLS validado.
- Representación entregable y XML recuperable durante la retención.
- Camino 61 o fallback oficial probado.
- Migración conciliada con proveedor, Mercado Pago y RCV.
- Pruebas, lint/check/build del repositorio en verde.
- Runbook y documentación operacional revisados por dueño/contador.

FORMA DE TRABAJO

- Implementa en incrementos pequeños y verificables.
- Antes de cada fase, muestra el diseño y riesgos que cambian decisiones tributarias.
- No inventes requisitos ni completes con suposiciones datos del emisor.
- No declares producción lista mientras quede un gate abierto.
- Al cerrar cada fase, informa archivos modificados, pruebas ejecutadas, evidencia SII y riesgos restantes.
```

## 16. Fuentes principales

### SII

- [Portal voucher/boleta y modelos de emisión](https://www.sii.cl/destacados/boleta_electronica_voucher/index.html)
- [OpenAPI oficial de boletas](https://www4c.sii.cl/bolcoreinternetui/api/openapi.json)
- [Formato de boleta electrónica v4.2](https://www.sii.cl/factura_electronica/factura_mercado/formato_boleta_electronica.pdf)
- [Formatos XML y esquemas](https://www.sii.cl/servicios_online/1039-formato_xml-1184.html)
- [Instructivo API de boleta](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf)
- [Guía de certificación de boleta](https://www.sii.cl/servicios_online/1039-guia_emitir_boleta_servicio-1184.html)
- [Proceso de certificación DTE](https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm)
- [Resolución 74/2020: emisión, envío, CAF y conservación](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf)
- [Resolución 53/2022: eliminación RVD](https://www.sii.cl/normativa_legislacion/resoluciones/2022/reso53.pdf)
- [FAQ RVD actualizada 2026-07-20](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7679.htm)
- [Resolución 53/2025: entrega impresa/virtual](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso53.pdf)
- [Resolución 207/2025: TED opcional en representación impresa](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso207.pdf)
- [Cambio de proveedor](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6485.htm)
- [Cambio a software propio](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6529.htm)
- [Cambio desde e-Boleta gratuita](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7816.htm)
- [Requisitos para proveedor de boleta electrónica](https://www.sii.cl/servicios_online/3785-.html)

### Proveedores y repositorios

- [Mercado Pago Boletas](https://www.mercadopago.cl/mp/boletas-electronicas)
- [Mercado Pago Point Smart 2](https://www.mercadopago.cl/herramientas-para-vender/lectores-point/point-smart-2)
- [SimpleAPI](https://www.simpleapi.cl/)
- [SimpleAPI precios](https://www.simpleapi.cl/Precios)
- [Facto](https://facto.cl/)
- [Facto precios](https://facto.cl/precios/)
- [laravel-dte-api](https://github.com/JavierAgueroCL/laravel-dte-api)
- [dte-sii](https://github.com/devlas-cl/dte-sii)
- [eboleta-sii](https://github.com/sebaiturravaldes/eboleta-sii)
- [BoletaHonorariosEmitir](https://github.com/FacTronica/BoletaHonorariosEmitir)
- [Hilo Reddit analizado](https://www.reddit.com/r/chileIT/comments/1pmhkuv/certificacion_al_sii_mediante_simpleapi/)

## 17. Decisión final propuesta

Para Atelier del Puerto hoy:

1. Confirmar el modelo de emisión y la inscripción actual del RUT.
2. Medir cuántas ventas mensuales son efectivo/transferencia.
3. Si el volumen manual es bajo, usar voucher + e-Boleta SII gratuita y no construir todavía.
4. Si el volumen manual afecta la operación, comparar el ahorro real con Mercado Pago anual antes de desarrollar.
5. Construir directo SII sólo como proyecto estratégico, empezando en certificación y con el diseño durable de este documento.

La respuesta técnica es **sí se puede**. La respuesta económica para un solo local es **no conviene hacerlo sólo por ahorrar la mensualidad**.
