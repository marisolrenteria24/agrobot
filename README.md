# AgroBot · Panel de control

Página web tipo PWA para el carrito agronómico: control por Bluetooth, telemetría
de sensores, historial en CSV, clima real y análisis de plantas.

Abrir `agrobot_control.html` en Chrome o Edge. Para que funcionen el service worker
y el análisis de plantas, sírvelo por http(s) (por ejemplo `python -m http.server`).

## Análisis de plantas (API + base de datos local)

El panel **Análisis de plantas** consulta de una sola vez dos fuentes y mezcla los
resultados en una sola lista:

1. **API de Kindwise (Plant Health).** Un único flujo, sin botones separados por
   tipo de API:
   - con Api-Key en el campo del panel → `POST https://plant.id/api/v3/health_assessment`
     (endpoint privado, cabecera `Api-Key`);
   - sin Api-Key → `POST https://agents.kindwise.com/plant_id/health_assessment`
     (endpoint público, sin llave y con límite de 10 consultas por IP cada 24 h).
2. **Base de datos local `plantas_local.json`.** Usa la misma estructura que las
   sugerencias de la API (`name`, `local_name`, `probability`, `description`,
   `cause`, `treatment`, `url`) más dos campos propios para poder cruzarla:
   `sinonimos` (búsqueda por nombre) y `sintomasVisuales` (etiquetas comparables
   con los colores que detecta la foto).

Cómo se cruzan:

- La foto se comprime a 1024 px y se manda a la API en base64.
- En paralelo se carga el JSON local y se buscan registros cuyos `sintomasVisuales`
  coincidan con los colores detectados en la foto (verde, amarillo, marrón,
  manchas oscuras, verde pálido).
- Las sugerencias de la API se contrastan por nombre con la base local: si hay
  coincidencia, la ficha indica `Kindwise + base local`; si no, se muestra solo
  el dato disponible, sin error.
- Si ninguna fuente devuelve nada, aparece un mensaje claro con el motivo.
- El campo **Buscar solo en la base local** permite consultar el JSON por nombre
  o síntoma sin depender de la API ni de la foto.

## Limitación del endpoint público

El endpoint público de Kindwise responde `403 browser_origin_forbidden` a toda
petición con cabecera `Origin`, o sea, desde el navegador (el preflight CORS
falla con `net::ERR_FAILED`). El módulo lo muestra como aviso y sigue con la base
local. Para usar la API desde la app publicada hay que pegar una Api-Key
(registro en https://admin.kindwise.com) o publicar el endpoint en un servidor
propio y cambiar `ANALISIS_API_PUBLICA` en `analisis_plantas.js`.

La Api-Key se guarda solo en el navegador (`localStorage`, clave
`kindwise_api_key`); nunca se escribe en el repositorio.

## Archivos

| Archivo | Estado | Contenido |
|---|---|---|
| `plantas_local.json` | nuevo | Base de datos local: 15 condiciones con la misma estructura que responde la API. |
| `analisis_plantas.js` | nuevo | Módulo único de análisis: API de Kindwise + base local + lista combinada. |
| `agrobot_control.html` | modificado | Panel *Análisis de plantas*; retiro del servo aspersor, del reproductor de música y de todos los emojis. |
| `sw.js` | modificado | Precachea `analisis_plantas.js` y `plantas_local.json`. |
| `README.md` | nuevo | Este documento. |

## Cambios retirados

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

## Merge

```bash
git checkout main
git merge --no-ff feature/kindwise-api-integration
```
