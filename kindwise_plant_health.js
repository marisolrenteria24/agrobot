// ---------------------------------------------------------------------------
// Kindwise · Plant Health API  (integracion nueva: rama feature/kindwise-api-integration)
//
// API PUBLICA (sin llave, trial oficial de Kindwise):
//   POST https://agents.kindwise.com/plant_id/health_assessment
//   Kindwise inyecta su propia llave del lado del servidor y limita a 10
//   consultas por IP cada 24 horas (HTTP 429 con enlace de registro).
//
// API PRIVADA (produccion de plant.health, con llave):
//   POST https://plant.id/api/v3/health_assessment   header: Api-Key: <llave>
//   Llaves: https://admin.kindwise.com   Documentacion: https://docs.kindwise.com
//
// Ambas comparten cuerpo JSON ({ images: [base64] }) y respuesta
// (result.is_plant, result.is_healthy, result.disease.suggestions),
// por eso lo unico que cambia entre llamadas es la URL y la llave.
//
// La foto se captura en el panel "Diagnóstico de planta" (codigo original);
// aqui solo se reenvia a Kindwise, no se toca ninguna logica existente.
// ---------------------------------------------------------------------------

// -------- CONFIGURACION --------
const KINDWISE_PUBLICA_URL = 'https://agents.kindwise.com/plant_id/health_assessment';
const KINDWISE_PRIVADA_URL = 'https://plant.id/api/v3/health_assessment';
const KINDWISE_IDIOMA = 'es';
const KINDWISE_DETALLES = 'local_name,description,cause,treatment,url';
const KINDWISE_LADO_MAXIMO = 1024; // lado maximo en pixeles de la foto enviada
const KINDWISE_LLAVE_STORAGE = 'kindwise_api_key';
const KINDWISE_ETIQUETAS_TRATAMIENTO = {
  biological: 'Biológico',
  chemical: 'Químico',
  prevention: 'Prevención',
  other: 'Otro'
};

// -------- ELEMENTOS DEL PANEL --------
const btnKindwisePublica = document.getElementById('btnKindwisePublica');
const btnKindwisePrivada = document.getElementById('btnKindwisePrivada');
const kindwiseEstado = document.getElementById('kindwiseEstado');
const kindwiseResultado = document.getElementById('kindwiseResultado');
const kindwiseApiKey = document.getElementById('kindwiseApiKey');
const kindwiseLlaveEstado = document.getElementById('kindwiseLlaveEstado');

let kindwiseOcupado = false;

// -------- LLAVE DE LA API PRIVADA (se guarda en este navegador) --------
function leerLlaveKindwise(){
  try { return localStorage.getItem(KINDWISE_LLAVE_STORAGE) || ''; }
  catch (e) { return ''; }
}

function guardarLlaveKindwise(){
  try { localStorage.setItem(KINDWISE_LLAVE_STORAGE, kindwiseApiKey.value.trim()); }
  catch (e) { /* sin almacenamiento disponible: la llave solo vive en la sesion */ }
}

function actualizarLlaveEstado(){
  kindwiseLlaveEstado.textContent = kindwiseApiKey.value.trim()
    ? 'llave guardada en este navegador'
    : 'sin llave guardada';
}

kindwiseApiKey.value = leerLlaveKindwise();
actualizarLlaveEstado();

kindwiseApiKey.addEventListener('input', () => {
  guardarLlaveKindwise();
  actualizarLlaveEstado();
});

// -------- FOTO (cargada por el panel de diagnostico original) --------
function fotoKindwise(){
  if (typeof imagenCargada === 'undefined' || !imagenCargada) return null;
  return previewFoto.src || null;
}

// Reduce la foto antes de enviarla: la API acepta base64 y una foto de camara
// completa supera con facilidad los megabytes que conviene subir.
function comprimirFotoKindwise(){
  const lienzo = document.createElement('canvas');
  const ladoOriginal = Math.max(imagenCargada.naturalWidth, imagenCargada.naturalHeight);
  const escala = Math.min(1, KINDWISE_LADO_MAXIMO / ladoOriginal);
  lienzo.width = Math.max(1, Math.round(imagenCargada.naturalWidth * escala));
  lienzo.height = Math.max(1, Math.round(imagenCargada.naturalHeight * escala));
  lienzo.getContext('2d').drawImage(imagenCargada, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL('image/jpeg', 0.85).split(',')[1]; // solo la parte base64
}

// -------- LLAMADA A LAS DOS APIS DE KINDWISE --------
async function llamarKindwise(config, base64){
  const url = config.url + '?language=' + KINDWISE_IDIOMA + '&details=' + KINDWISE_DETALLES;
  const encabezados = { 'Content-Type': 'application/json' };
  if (config.llave) encabezados['Api-Key'] = config.llave; // solo la API privada

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      headers: encabezados,
      body: JSON.stringify({ images: [base64] })
    });
  } catch (e) {
    if (config.cual === 'publica') {
      throw new Error('Kindwise rechazó la llamada desde el navegador (' + e.message +
        '). Su API pública solo responde a peticiones de servidor, así que usa la API privada ' +
        'o publica el mismo endpoint en tu propio dominio (ver README_KINDWISE.md).');
    }
    throw new Error('No se pudo conectar con Kindwise (' + e.message + ')');
  }

  const texto = await respuesta.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch (e) { datos = null; }

  if (!respuesta.ok) throw new Error(mensajeErrorKindwise(respuesta.status, datos, texto));
  if (!datos) throw new Error('Kindwise devolvió una respuesta que no se pudo leer.');
  return datos;
}

function mensajeErrorKindwise(status, datos, texto){
  if (datos && datos.error === 'browser_origin_forbidden') {
    return 'la API pública de Kindwise no acepta llamadas directas desde el navegador (403). ' +
      'Usa la API privada con tu llave o publica este endpoint en tu propio servidor.';
  }
  if (status === 401) return 'llave rechazada (401), revisa tu Api-Key.';
  if (status === 429) {
    let mensaje = (datos && datos.message) ? datos.message : 'límite de consultas alcanzado (429).';
    if (datos && datos.registration_url) mensaje += ' Regístrate en ' + datos.registration_url;
    return mensaje;
  }
  if (datos && (datos.message || datos.error)) return (datos.message || datos.error) + ' (' + status + ')';
  if (texto) return texto.substring(0, 160) + ' (' + status + ')';
  return 'error ' + status;
}

// -------- PINTAR RESULTADOS --------
function porcentajeKindwise(valor){
  if (valor === undefined || valor === null) return '--';
  return (valor * 100).toFixed(1) + '%';
}

function agregarNodoKindwise(padre, etiqueta, texto, estilo){
  const nodo = document.createElement(etiqueta);
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  if (estilo) nodo.setAttribute('style', estilo);
  padre.appendChild(nodo);
  return nodo;
}

function pintarSugerenciaKindwise(sugerencia){
  const detalles = sugerencia.details || {};
  const detalle = detalles[KINDWISE_IDIOMA] || detalles; // respuestas multilenguaje

  const caja = agregarNodoKindwise(kindwiseResultado, 'div', null,
    'background:var(--soil-800); border:1px solid var(--soil-700); border-radius:10px; padding:10px 12px; margin-bottom:8px;');

  agregarNodoKindwise(caja, 'div',
    (detalle.local_name || sugerencia.name) + '  ·  ' + porcentajeKindwise(sugerencia.probability),
    'font-weight:600;');

  if (detalle.description) {
    agregarNodoKindwise(caja, 'div', detalle.description, 'font-family:var(--font-display); font-size:13px; margin-top:4px;');
  }
  if (detalle.cause) {
    agregarNodoKindwise(caja, 'div', 'Causa: ' + detalle.cause, 'font-family:var(--font-display); font-size:12px; margin-top:4px; opacity:0.8;');
  }

  const tratamiento = detalle.treatment || {};
  Object.keys(tratamiento).forEach(clave => {
    const pasos = tratamiento[clave];
    if (!Array.isArray(pasos) || pasos.length === 0) return;
    const etiqueta = KINDWISE_ETIQUETAS_TRATAMIENTO[clave] || clave;
    agregarNodoKindwise(caja, 'div', etiqueta + ': ' + pasos.join(' · '),
      'font-family:var(--font-display); font-size:12px; margin-top:4px;');
  });

  if (detalle.url) {
    const enlace = agregarNodoKindwise(caja, 'a', 'Más información', 'display:inline-block; margin-top:6px; color:var(--sky-400); font-size:12px;');
    enlace.href = detalle.url;
    enlace.target = '_blank';
    enlace.rel = 'noopener';
  }
}

function pintarResultadoKindwise(nombreApi, datos){
  const resultado = datos.result || {};
  kindwiseResultado.innerHTML = '';
  kindwiseResultado.style.display = 'block';

  agregarNodoKindwise(kindwiseResultado, 'div',
    nombreApi + ' · ' + new Date().toLocaleString('es-MX'),
    'color:var(--text-400); margin-bottom:8px;');

  const planta = resultado.is_plant;
  if (planta && planta.binary === false) {
    agregarNodoKindwise(kindwiseResultado, 'div',
      'La foto no parece una planta (prob. ' + porcentajeKindwise(planta.probability) +
      '). Toma otra foto con la planta en primer plano.');
    return;
  }
  if (planta) {
    agregarNodoKindwise(kindwiseResultado, 'div',
      'Planta detectada: sí (' + porcentajeKindwise(planta.probability) + ')');
  }

  const salud = resultado.is_healthy;
  if (salud) {
    const sana = salud.binary === true;
    agregarNodoKindwise(kindwiseResultado, 'div',
      (sana ? 'La planta se ve sana — ' : 'La planta presenta problemas — ') +
      'probabilidad de salud ' + porcentajeKindwise(salud.probability),
      'margin-top:4px; color:' + (sana ? 'var(--leaf-500);' : 'var(--amber-500);'));
  }

  const sugerencias = (resultado.disease && resultado.disease.suggestions) || [];
  if (sugerencias.length === 0) {
    agregarNodoKindwise(kindwiseResultado, 'div',
      'Kindwise no reporta enfermedades para esta foto.',
      'color:var(--text-400); margin-top:8px;');
  } else {
    agregarNodoKindwise(kindwiseResultado, 'div', 'Posibles causas',
      'color:var(--text-400); margin-top:14px; margin-bottom:6px;');
    sugerencias.slice(0, 3).forEach(sugerencia => pintarSugerenciaKindwise(sugerencia));
  }

  agregarNodoKindwise(kindwiseResultado, 'div',
    'modelo ' + (datos.model_version || '-') + ' · token ' + (datos.access_token || '-'),
    'font-size:11px; color:var(--text-600); margin-top:10px;');
}

// -------- FLUJO DE LOS DOS BOTONES --------
async function analizarKindwise(cual){
  if (kindwiseOcupado) return;

  if (!fotoKindwise()) {
    kindwiseEstado.textContent = 'Primero toma una foto en el panel Diagnóstico de planta.';
    return;
  }

  const llave = kindwiseApiKey.value.trim();
  if (cual === 'privada' && !llave) {
    kindwiseEstado.textContent = 'Pega tu Api-Key de Kindwise para usar la API privada.';
    return;
  }

  const config = cual === 'privada'
    ? { cual, nombre: 'API privada', url: KINDWISE_PRIVADA_URL, llave }
    : { cual, nombre: 'API pública', url: KINDWISE_PUBLICA_URL, llave: '' };

  kindwiseOcupado = true;
  btnKindwisePublica.disabled = true;
  btnKindwisePrivada.disabled = true;
  kindwiseResultado.style.display = 'none';
  kindwiseEstado.textContent = 'Consultando ' + config.nombre + '...';

  try {
    const base64 = comprimirFotoKindwise();
    const datos = await llamarKindwise(config, base64);
    kindwiseEstado.textContent = config.nombre + ' · ' + new Date().toLocaleTimeString('es-MX');
    pintarResultadoKindwise(config.nombre, datos);
  } catch (err) {
    kindwiseEstado.textContent = 'Error: ' + err.message;
    kindwiseResultado.style.display = 'none';
  } finally {
    kindwiseOcupado = false;
    btnKindwisePublica.disabled = false;
    btnKindwisePrivada.disabled = false;
  }
}

btnKindwisePublica.addEventListener('click', () => analizarKindwise('publica'));
btnKindwisePrivada.addEventListener('click', () => analizarKindwise('privada'));
