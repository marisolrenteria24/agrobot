# AgroBot · Panel de control

Página web tipo PWA para el carrito agronómico: control por Bluetooth, telemetría
de sensores, historial en CSV, clima real y diagnóstico de planta por color.

Abrir `agrobot_control.html` en Chrome o Edge. Para que funcione el service
worker, sírvelo por http(s) (por ejemplo `python -m http.server`).

## Diagnóstico de planta

El panel **Diagnóstico de planta** toma una foto con la cámara y hace un
análisis local de color en el navegador. Separa cinco estados del follaje:
verde sano, verde pálido (estrés hídrico o poca luz), amarillo (falta de
nutrientes), café/seco (tejido muerto) y manchas oscuras (posible hongo o
necrosis). No usa ninguna API ni servicio externo.

Dos detalles que hacen el diagnóstico más confiable:

- **Corrección de exposición.** Si la foto salió oscura o muy clara, se aplica
  un único factor a los tres canales por igual, de modo que se corrige el
  brillo sin alterar los colores. Se descartaron el balance de blancos y el
  estiramiento por canal: probados, empeoraban el resultado (ver el comentario
  de `normalizarIluminacion` en `inteligencia_agronomica.js`).
- **Reglas sin valores absolutos.** La clasificación usa saturación y relaciones
  entre canales en lugar de umbrales fijos de brillo, así que una hoja sana se
  sigue reconociendo como sana independientemente de cómo salga expuesta la foto.

Además, cada foto que analizas se guarda en el navegador y el panel muestra una
**comparación con la foto anterior**: las dos miniaturas lado a lado, una tabla
con el porcentaje de cada color antes, ahora y la diferencia, y un veredicto
("mejoró", "empeoró" o "no cambió"). La comparación se guarda en `localStorage`
y conserva las últimas 6 fotos.

Se retiró la integración con la API de Kindwise (endpoint público
`agents.kindwise.com` y endpoint privado `plant.id`), su campo de Api-Key, el
módulo `analisis_plantas.js` y la base de datos local `plantas_local.json`.

## Inteligencia agronómica local

El panel **Inteligencia agronómica** (`inteligencia_agronomica.js`) cruza cinco
fuentes y todo se calcula en el navegador (sin API, sin llaves, funciona
offline):

1. **La foto** del panel de diagnóstico (el análisis de color descrito arriba).
2. **La telemétrica del carrito**: humedad del suelo, temperatura y nivel del
   tanque de agua.
3. **El clima** de Open-Meteo: probabilidad de lluvia para decidir si conviene
   regar.
4. **El tipo de planta**, que el usuario elige en un selector. Cada cultivo
   define su propio rango cómodo de suelo y temperatura, además de una nota de
   manejo. Hay 8 perfiles: genérica, tomate, chile, albahaca, maíz, frijol,
   nopal y orquídea. La selección se recuerda.
5. **Las plagas observadas** a simple vista, en casillas (pulgones, hongos,
   manchas, orugas, araña roja). Cada una resta puntos y aporta su acción de
   control.

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
| `inteligencia_agronomica.js` | Motor local: foto + sensores + clima + tipo de planta + plagas → índice de salud y recomendaciones. También aporta el análisis de color del diagnóstico. |
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

## Cómo publicar cambios

El service worker guarda la app en caché con una estrategia *cache-first*, así
que los visitantes no ven las novedades hasta que se indique que hay versión
nueva. Al subir cambios hay que:

1. Cambiar `CACHE_NAME` en `sw.js` (por ejemplo `agrobot-cache-v3` → `v4`).
2. Cambiar el número de versión del módulo en `agrobot_control.html` y en la
   lista `ARCHIVOS_CASCARON` de `sw.js` (`inteligencia_agronomica.js?v=8` →
   `?v=9`). Así el navegador no reutiliza el archivo viejo.

La app ya se recarga sola una vez cuando el navegador detecta un service worker
nuevo, así que con esos dos cambios los usuarios ven la actualización sin tener
que borrar la caché a mano.
