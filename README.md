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

## Archivos

| Archivo | Contenido |
|---|---|
| `agrobot_control.html` | Panel de control completo (Bluetooth, telemetría, clima, diagnóstico por color, bitácora). |
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
