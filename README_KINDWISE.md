# Integración de las APIs de Kindwise (rama `feature/kindwise-api-integration`)

Esta rama agrega el diagnóstico de salud de planta con las dos APIs de Kindwise
(Plant Health) a la app del carrito agronómico, sin cambiar la arquitectura,
los archivos, las rutas ni la lógica existente.

## Qué se agregó

| Archivo | Tipo | Contenido |
|---|---|---|
| `kindwise_plant_health.js` | nuevo | Módulo completo de la integración: llamadas, compresión de la foto y pintado de resultados. |
| `README_KINDWISE.md` | nuevo | Este documento. |
| `agrobot_control.html` | solo adiciones | Panel nuevo "Salud de la planta · Kindwise" + una etiqueta `<script>` al final del cuerpo. |
| `sw.js` | solo adición | `./kindwise_plant_health.js` en la lista de precacheo (una línea). |

Ninguna función, variable ni sección original fue modificada o eliminada.

## API pública (sin llave)

- **Endpoint:** `POST https://agents.kindwise.com/plant_id/health_assessment`
- **Dónde está en el código:** `kindwise_plant_health.js`, constantes
  `KINDWISE_PUBLICA_URL` y la función `llamarKindwise(config, base64)`.
- **Botón en la UI:** "Analizar con API pública", panel
  **Salud de la planta · Kindwise** (`agrobot_control.html`).
- **Detalle:** es el trial público de Kindwise para agentes; la llave la inyecta
  el propio servidor y limita a 10 consultas por IP cada 24 horas. Si se excede,
  responde `HTTP 429` con la URL de registro y ese mensaje se muestra en el panel.
- **Limitación importante:** el trial público responde `403 browser_origin_forbidden`
  cuando la petición lleva cabecera `Origin`, es decir, cuando viene del navegador
  de otro sitio. En la práctica el navegador ni siquiera puede leer esa respuesta
  (el preflight CORS falla con `net::ERR_FAILED`), así que el código traduce ese
  fallo a un mensaje claro en el panel y sugiere usar la API privada. Para usar la
  API pública desde la app publicada, publica el mismo endpoint en tu propio
  servidor (relay) y cambia `KINDWISE_PUBLICA_URL` por esa URL. Sin cabecera
  `Origin` (llamada de servidor) el endpoint responde `201` con el diagnóstico
  completo: eso se verificó contra el endpoint real.

## API privada (con llave)

- **Endpoint:** `POST https://plant.id/api/v3/health_assessment` con cabecera
  `Api-Key: <llave>` (Plant.health / Plant.id v3 de Kindwise).
- **Dónde está en el código:** `kindwise_plant_health.js`, constante
  `KINDWISE_PRIVADA_URL`, cabecera `Api-Key` armada en `llamarKindwise()`.
- **Botón en la UI:** "Analizar con API privada" y el campo
  **Api-Key privada** del panel **Salud de la planta · Kindwise**.
- **La llave** se escribe una sola vez en el campo y se guarda en
  `localStorage` con la clave `kindwise_api_key`. Nunca se escribe en el
  repositorio ni viaja a otro servidor que no sea `plant.id`.
- **Verificado:** `plant.id` contesta con `Access-Control-Allow-Origin: *` y
  acepta la cabecera `api-key`, así que el navegador puede llamarlo directo.

## Cómo funciona (común a las dos APIs)

1. La foto se toma en el panel existente **Diagnóstico de planta** (no se
   duplica ni se modifica ese flujo).
2. `comprimirFotoKindwise()` reduce la imagen a 1024 px de lado máximo y la
   convierte a JPEG en base64 (formato que documenta la API).
3. Se envía `{"images": ["<base64>"]}` con `?language=es&details=local_name,description,cause,treatment,url`.
   Ojo: nunca se envía `similar_images=false`, la API lo rechaza.
4. La respuesta se lee igual para ambas: `result.is_plant`,
   `result.is_healthy` y `result.disease.suggestions[]`, y se pintan en
   `pintarResultadoKindwise()` (nombre localizado, probabilidad, descripción,
   causa, tratamiento y enlace).

## Pruebas hechas contra la API pública

- `POST` sin cabecera `Origin` → `201` con `is_plant`, `is_healthy` y
  `disease.suggestions` (respuesta en español con `language=es`).
- `similar_images=false` → `400 Unknown modifier` (por eso se omite).
- `Origin` del navegador → `403 browser_origin_forbidden`.

## Cómo hacer merge

```bash
git checkout main
git merge --no-ff feature/kindwise-api-integration
```

Los cambios sobre archivos existentes son adiciones (un panel nuevo, una
etiqueta `<script>` y una línea en el arreglo de caché), así que el merge no
debe generar conflictos con otros trabajos sobre `main`.
