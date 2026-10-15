# AgroBot · Panel de control

Página web tipo PWA para el carrito agronómico: control por Bluetooth, telemetría
de sensores, historial en CSV, clima real y diagnóstico de planta por color.

Abrir `agrobot_control.html` en Chrome o Edge. Para que funcione el service
worker, sírvelo por http(s) (por ejemplo `python -m http.server`).

## Diagnóstico de planta (por color, sin API)

El panel **Diagnóstico de planta** toma una foto con la cámara y hace un
análisis local de color en el navegador (verde vs. amarillo/seco): cuenta el
porcentaje de follaje verde y estima si la planta se ve saludable o con estrés.
No usa ninguna API ni servicio externo, es una estimación rápida útil como
primer vistazo. La foto y la nota se guardan en la bitácora mientras la app
esté abierta.

Se retiró la integración con la API de Kindwise (endpoint público
`agents.kindwise.com` y endpoint privado `plant.id`), su campo de Api-Key, el
módulo `analisis_plantas.js` y la base de datos local `plantas_local.json`.

## Inteligencia agronómica local

El panel **Inteligencia agronómica** (`inteligencia_agronomica.js`) cruza tres
fuentes que la app ya tiene y todo se calcula en el navegador (sin API, sin
llaves, funciona offline):

1. **La foto** del panel de diagnóstico, con análisis de color avanzado:
   verde sano, verde pálido (estrés hídrico), amarillo (nutrición), café/seco
   (tejido muerto) y manchas oscuras (posible hongo).
2. **La telemétrica del carrito**: humedad del suelo, temperatura y nivel del
   tanque de agua.
3. **El clima** de Open-Meteo: probabilidad de lluvia para decidir si conviene
   regar.

La salida es un índice de salud 0-100 con semáforo, la lista de factores que
bajaron o subieron el índice (con los puntos de cada uno), las acciones
recomendadas y la tendencia contra la evaluación anterior (guardada en
`localStorage`). Si falta una fuente, el motor lo dice explícitamente en
"Faltan datos".

Para probarlo sin el carrito, desde la consola del navegador:
`window.agrobotTelemetriaDemo = { SUELO: '22', TEMP: '37.5', AGUA: '55' }` y
`window.agrobotImagenDemo` con el dataURL de una foto.

## Archivos

| Archivo | Contenido |
|---|---|
| `agrobot_control.html` | Panel de control completo (Bluetooth, telemetría, clima, diagnóstico por color, inteligencia agronómica, bitácora). |
| `inteligencia_agronomica.js` | Motor local: foto + sensores + clima → índice de salud y recomendaciones. |
| `sw.js` | Service worker: cachea el cascarón de la app. |
| `manifest.json` | Datos de la PWA. |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | Iconos de la PWA. |

## Cambios retirados

- **API de Kindwise (pública y privada):** se eliminó el módulo
  `analisis_plantas.js`, la base local `plantas_local.json`, el panel
  *Análisis de plantas*, el campo de Api-Key y el precacheo en `sw.js`.
- **Servomotor:** se eliminó el bloque del slider *Servo aspersor*, el
  desplazamiento `SERVO:<0-100>`, las variables `servoSlider`/`servoVal`/
  `servoDebounce`, el estado `servoSlider.disabled` al conectar y el CSS
  `.servo-wrap` e `input[type="range"]`.
- **Música:** se eliminó el panel completo (selector de canción, reproductor,
  volumen y «reproducir al conectar»), las variables `reproductor`,
  `btnPlayPause`, `volumenSlider`, `cancionNombre`, `autoplayToggle`,
  `inputMusica`, `btnElegirMusica` y la función `intentarAutoplayMusica()`.
  El sonido de conexión/desconexión (`reproducirChime`) no es música y se
  mantiene.
- **Emojis:** se retiraron de toda la interfaz (marca, botones, alertas,
  mensajes de clima, diagnóstico por color, bitácora y control por voz). Las
  flechas del pad de dirección usan ahora glifos de texto (↑ ← → ↓).
