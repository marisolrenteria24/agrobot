// ---------------------------------------------------------------------------
// Análisis de plantas: API de Kindwise + base de datos local
// (rama feature/kindwise-api-integration)
//
// Un solo flujo para las dos fuentes:
//   1) API de Kindwise (Plant Health): se usa el endpoint privado
//      https://plant.id/api/v3/health_assessment si el usuario pegó su Api-Key,
//      o el público https://agents.kindwise.com/plant_id/health_assessment si no.
//      No hay botones ni lógica separada por tipo de API.
//   2) Base de datos local plantas_local.json: misma estructura que las
//      sugerencias de la API (name, local_name, description, cause, treatment,
//      url) más los campos sinonimos y sintomasVisuales para poder cruzarla.
//
// Los resultados se mezclan en una sola lista. Si una fuente no contesta, se
// muestra la otra; si no hay nada, se avisa con un mensaje claro.
// ---------------------------------------------------------------------------

// -------- CONFIGURACION --------
const ANALISIS_API_PUBLICA = 'https://agents.kindwise.com/plant_id/health_assessment';
const ANALISIS_API_PRIVADA = 'https://plant.id/api/v3/health_assessment';
const ANALISIS_BASE_LOCAL = 'plantas_local.json';
const ANALISIS_IDIOMA = 'es';
const ANALISIS_DETALLES = 'local_name,description,cause,treatment,url';
const ANALISIS_LADO_MAXIMO = 1024; // lado maximo en pixeles de la foto enviada
const ANALISIS_LLAVE_STORAGE = 'kindwise_api_key';
const ANALISIS_ETIQUETAS_TRATAMIENTO = {
  biological: 'Biológico',
  chemical: 'Químico',
  prevention: 'Prevención',
  other: 'Otro'
};
// fraccion minima de pixeles para sumar un sintoma visual detectado en la foto
const ANALISIS_UMBRAL_VISUAL = 0.1;

// -------- ELEMENTOS DEL PANEL --------
const btnAnalizarPlantas = document.getElementById('btnAnalizarPlantas');
const analisisEstado = document.getElementById('analisisEstado');
const analisisResultado = document.getElementById('analisisResultado');
const analisisApiKey = document.getElementById('analisisApiKey');
const analisisLlaveEstado = document.getElementById('analisisLlaveEstado');
const analisisBusqueda = document.getElementById('analisisBusqueda');
const btnBuscarLocal = document.getElementById('btnBuscarLocal');

let analisisOcupado = false;
let analisisBase = null; // cache de la base local

// -------- LLAVE OPCIONAL DE KINDWISE --------
function leerLlaveAnalisis(){
  try { return localStorage.getItem(ANALISIS_LLAVE_STORAGE) || ''; }
  catch (e) { return ''; }
}

function guardarLlaveAnalisis(){
  try { localStorage.setItem(ANALISIS_LLAVE_STORAGE, analisisApiKey.value.trim()); }
  catch (e) { /* sin almacenamiento disponible: la llave solo vive en la sesion */ }
}

function actualizarLlaveAnalisis(){
  analisisLlaveEstado.textContent = analisisApiKey.value.trim()
    ? 'con llave se usa el endpoint privado'
    : 'sin llave, se usa el endpoint público';
}

analisisApiKey.value = leerLlaveAnalisis();
actualizarLlaveAnalisis();

analisisApiKey.addEventListener('input', () => {
  guardarLlaveAnalisis();
  actualizarLlaveAnalisis();
});

// -------- FOTO (cargada por el panel de diagnostico original) --------
function fotoAnalisis(){
  if (typeof imagenCargada === 'undefined' || !imagenCargada) return null;
  return previewFoto.src || null;
}

function comprimirFotoAnalisis(){
  const lienzo = document.createElement('canvas');
  const ladoOriginal = Math.max(imagenCargada.naturalWidth, imagenCargada.naturalHeight);
  const escala = Math.min(1, ANALISIS_LADO_MAXIMO / ladoOriginal);
  lienzo.width = Math.max(1, Math.round(imagenCargada.naturalWidth * escala));
  lienzo.height = Math.max(1, Math.round(imagenCargada.naturalHeight * escala));
  lienzo.getContext('2d').drawImage(imagenCargada, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL('image/jpeg', 0.85).split(',')[1]; // solo la parte base64
}

// -------- BASE DE DATOS LOCAL --------
async function cargarBaseLocal(){
  if (analisisBase) return analisisBase;
  try {
    const respuesta = await fetch(ANALISIS_BASE_LOCAL);
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    const datos = await respuesta.json();
    analisisBase = Array.isArray(datos) ? datos : (datos.plantas || []);
  } catch (e) {
    console.warn('No se pudo cargar ' + ANALISIS_BASE_LOCAL, e);
    analisisBase = [];
  }
  return analisisBase;
}

function normalizarAnalisis(texto){
  return (texto === undefined || texto === null ? '' : String(texto))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function textoBuscable(planta){
  return normalizarAnalisis([
    planta.name, planta.local_name,
    (planta.sinonimos || []).join(' '),
    (planta.sintomasVisuales || []).join(' '),
    planta.description, planta.cause
  ].join(' '));
}

function buscarEnBaseLocal(base, texto){
  const tokens = normalizarAnalisis(texto).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return base.filter(planta => {
    const campos = textoBuscable(planta);
    return tokens.every(token => campos.indexOf(token) !== -1);
  });
}

function sinRepetidos(registros){
  const vistos = new Set();
  return registros.filter(registro => {
    if (vistos.has(registro.name)) return false;
    vistos.add(registro.name);
    return true;
  });
}

// -------- SINTOMAS VISUALES DE LA FOTO --------
// Muestrea la foto y devuelve etiquetas comparables con "sintomasVisuales"
// de la base local. Es el mismo criterio de color que usa el análisis básico
// del panel de diagnóstico (verde vs. amarillento/seco), ampliado a marrón,
// manchas oscuras y hojas pálidas.
function detectarSintomasVisuales(){
  const escala = 100;
  const lienzo = document.createElement('canvas');
  lienzo.width = escala;
  lienzo.height = escala;
  const ctx = lienzo.getContext('2d');
  ctx.drawImage(imagenCargada, 0, 0, escala, escala);

  const pixeles = ctx.getImageData(0, 0, escala, escala).data;
  let verdes = 0, palidas = 0, amarillas = 0, marrones = 0, oscuros = 0, total = 0;

  for (let i = 0; i < pixeles.length; i += 4) {
    const r = pixeles[i], g = pixeles[i + 1], b = pixeles[i + 2];
    const brillo = (r + g + b) / 3;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (brillo < 25 || brillo > 240 || chroma < 25) continue; // fondo y grises

    total++;
    if (brillo < 60) { oscuros++; continue; }                     // manchas oscuras
    if (g > r * 1.05 && g > b * 1.1) {                            // verde
      verdes++;
      if (chroma < 45) palidas++;                                 // verde apagado
    } else if (r > b * 1.15 && g > b * 1.1 && Math.abs(r - g) < 60) {
      amarillas++;                                                // amarillo
    } else if (r > g * 1.15 && g >= b) {
      marrones++;                                                 // marron / seco
    }
  }

  if (total < 50) return []; // no se detecto follaje suficiente

  const salida = [];
  if (verdes / total >= 0.35) salida.push('hojas_verdes');
  if (palidas / total >= 0.3) salida.push('hojas_palidas');
  if (amarillas / total >= ANALISIS_UMBRAL_VISUAL) salida.push('hojas_amarillas');
  if (marrones / total >= ANALISIS_UMBRAL_VISUAL) salida.push('manchas_marrones');
  if (oscuros / total >= ANALISIS_UMBRAL_VISUAL) salida.push('puntos_negros');
  if ((marrones + oscuros) / total >= 0.45) salida.push('hojas_marchitas');
  return salida;
}

// -------- LLAMADA A LA API DE KINDWISE --------
async function llamarApiAnalisis(base64, llave){
  // un solo camino: con llave endpoint privado, sin llave endpoint público
  const urlBase = llave ? ANALISIS_API_PRIVADA : ANALISIS_API_PUBLICA;
  const url = urlBase + '?language=' + ANALISIS_IDIOMA + '&details=' + ANALISIS_DETALLES;
  const encabezados = { 'Content-Type': 'application/json' };
  if (llave) encabezados['Api-Key'] = llave;

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      headers: encabezados,
      body: JSON.stringify({ images: [base64] })
    });
  } catch (e) {
    if (!llave) {
      throw new Error('el endpoint público de Kindwise no acepta llamadas desde el navegador (' +
        e.message + '). Pegando tu Api-Key se usa el endpoint privado, que sí funciona.');
    }
    throw new Error('no se pudo conectar con Kindwise (' + e.message + ')');
  }

  const texto = await respuesta.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch (e) { datos = null; }

  if (!respuesta.ok) throw new Error(mensajeErrorAnalisis(respuesta.status, datos, texto));
  return datos;
}

function mensajeErrorAnalisis(status, datos, texto){
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

// -------- COMBINAR LAS DOS FUENTES --------
function detallesDe(sugerencia){
  const detalles = sugerencia.details || {};
  return detalles[ANALISIS_IDIOMA] || detalles; // respuestas multilenguaje
}

function mismaPlanta(registro, sugerencia){
  const claves = [registro.name, registro.local_name, ...(registro.sinonimos || [])]
    .map(clave => normalizarAnalisis(clave));
  const candidatas = [sugerencia.name, detallesDe(sugerencia).local_name]
    .map(clave => normalizarAnalisis(clave))
    .filter(Boolean);
  return candidatas.some(candidata =>
    claves.some(clave => clave === candidata || clave.indexOf(candidata) !== -1 || candidata.indexOf(clave) !== -1));
}

function combinarResultados(sugerenciasApi, locales){
  const items = [];
  const usados = new Set();

  sugerenciasApi.forEach(sugerencia => {
    const local = locales.find(registro => mismaPlanta(registro, sugerencia));
    if (local) usados.add(local.name);
    items.push({
      origen: local ? 'Kindwise + base local' : 'Kindwise',
      probabilidad: sugerencia.probability,
      nombre: detallesDe(sugerencia).local_name || sugerencia.name,
      descripcion: detallesDe(sugerencia).description || '',
      causa: detallesDe(sugerencia).cause || '',
      tratamiento: detallesDe(sugerencia).treatment || {},
      url: detallesDe(sugerencia).url || ''
    });
  });

  locales.forEach(registro => {
    if (usados.has(registro.name)) return;
    items.push({
      origen: 'Base local',
      probabilidad: null,
      nombre: registro.local_name || registro.name,
      descripcion: registro.description || '',
      causa: registro.cause || '',
      tratamiento: registro.treatment || {},
      url: registro.url || ''
    });
  });

  items.sort((a, b) => (b.probabilidad || 0) - (a.probabilidad || 0));
  return items;
}

// -------- PINTAR LA LISTA UNIFICADA --------
function agregarNodoAnalisis(padre, etiqueta, texto, estilo){
  const nodo = document.createElement(etiqueta);
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  if (estilo) nodo.setAttribute('style', estilo);
  padre.appendChild(nodo);
  return nodo;
}

function porcentajeAnalisis(valor){
  if (valor === undefined || valor === null) return '';
  return (valor * 100).toFixed(1) + '%';
}

function pintarFicha(item){
  const caja = agregarNodoAnalisis(analisisResultado, 'div', null,
    'background:var(--soil-800); border:1px solid var(--soil-700); border-radius:10px; padding:12px; margin-bottom:8px;');

  const titulo = item.nombre + (item.probabilidad !== null ? '  ·  ' + porcentajeAnalisis(item.probabilidad) : '');
  agregarNodoAnalisis(caja, 'div', titulo, 'font-weight:600;');
  agregarNodoAnalisis(caja, 'div', 'Origen: ' + item.origen, 'font-size:11px; color:var(--text-400); margin-top:2px;');

  if (item.descripcion) {
    agregarNodoAnalisis(caja, 'div', item.descripcion, 'font-size:13px; margin-top:6px;');
  }
  if (item.causa) {
    agregarNodoAnalisis(caja, 'div', 'Causa: ' + item.causa, 'font-size:12px; margin-top:4px; opacity:0.8;');
  }

  Object.keys(item.tratamiento).forEach(clave => {
    const pasos = item.tratamiento[clave];
    if (!Array.isArray(pasos) || pasos.length === 0) return;
    const etiqueta = ANALISIS_ETIQUETAS_TRATAMIENTO[clave] || clave;
    agregarNodoAnalisis(caja, 'div', etiqueta + ': ' + pasos.join(' · '), 'font-size:12px; margin-top:4px;');
  });

  if (item.url) {
    const enlace = agregarNodoAnalisis(caja, 'a', 'Más información', 'display:inline-block; margin-top:6px; color:var(--sky-400); font-size:12px;');
    enlace.href = item.url;
    enlace.target = '_blank';
    enlace.rel = 'noopener';
  }
}

function pintarLista(items, notaApi){
  analisisResultado.innerHTML = '';
  analisisResultado.style.display = 'block';

  const fuentes = Array.from(new Set(items.map(item => item.origen))).join(' + ');
  agregarNodoAnalisis(analisisResultado, 'div',
    items.length + (items.length === 1 ? ' coincidencia' : ' coincidencias') + ' · ' + fuentes,
    'font-family:var(--font-mono); font-size:12px; color:var(--text-400); margin-bottom:10px;');

  if (notaApi) {
    agregarNodoAnalisis(analisisResultado, 'div', 'Aviso de la API: ' + notaApi,
      'font-family:var(--font-mono); font-size:12px; color:var(--amber-500); margin-bottom:10px;');
  }

  items.forEach(pintarFicha);
}

function pintarMensaje(texto){
  analisisResultado.innerHTML = '';
  analisisResultado.style.display = 'block';
  agregarNodoAnalisis(analisisResultado, 'div', texto, 'font-family:var(--font-mono); font-size:13px;');
}

// -------- FLUJO UNICO DE ANALISIS --------
async function analizarPlantas(){
  if (analisisOcupado) return;

  if (!fotoAnalisis()) {
    analisisEstado.textContent = 'Primero toma una foto en el panel Diagnóstico de planta.';
    return;
  }

  analisisOcupado = true;
  btnAnalizarPlantas.disabled = true;
  analisisResultado.style.display = 'none';
  analisisEstado.textContent = 'Analizando foto...';

  try {
    const base64 = comprimirFotoAnalisis();
    const sintomasVisuales = detectarSintomasVisuales();
    const llave = analisisApiKey.value.trim();

    // API y base local se consultan en paralelo; si una falla, sigue la otra
    const [respuestaApi, base] = await Promise.all([
      llamarApiAnalisis(base64, llave).catch(error => ({ error: error.message })),
      cargarBaseLocal()
    ]);

    const sugerenciasApi = (respuestaApi.result && respuestaApi.result.disease && respuestaApi.result.disease.suggestions) || [];

    const porSintoma = base.filter(registro =>
      (registro.sintomasVisuales || []).some(sintoma => sintomasVisuales.indexOf(sintoma) !== -1));

    const porNombre = [];
    sugerenciasApi.forEach(sugerencia => {
      const detalle = detallesDe(sugerencia);
      buscarEnBaseLocal(base, detalle.local_name || sugerencia.name).forEach(registro => porNombre.push(registro));
    });

    const locales = sinRepetidos([...porSintoma, ...porNombre]);
    const items = combinarResultados(sugerenciasApi, locales);

    if (items.length === 0) {
      analisisEstado.textContent = 'Sin resultados';
      const motivo = base.length === 0
        ? 'Tampoco se pudo cargar la base local ' + ANALISIS_BASE_LOCAL + '.'
        : 'La base local revisó ' + base.length + ' registros y ninguno coincide con la foto.';
      pintarMensaje('No se encontró ninguna coincidencia en la API ni en la base local. ' +
        motivo + ' Prueba con otra foto con la planta en primer plano y buena luz.');
      return;
    }

    analisisEstado.textContent = 'Listo · ' + new Date().toLocaleTimeString('es-MX');
    pintarLista(items, respuestaApi.error || null);
  } catch (err) {
    analisisEstado.textContent = 'Error';
    pintarMensaje('No se pudo analizar la foto: ' + err.message);
  } finally {
    analisisOcupado = false;
    btnAnalizarPlantas.disabled = false;
  }
}

// -------- BUSQUEDA MANUAL EN LA BASE LOCAL --------
async function buscarLocal(){
  const texto = analisisBusqueda.value.trim();
  if (!texto) {
    analisisEstado.textContent = 'Escribe un nombre o un síntoma para buscar en la base local.';
    return;
  }

  const base = await cargarBaseLocal();
  if (base.length === 0) {
    analisisEstado.textContent = 'Sin base local';
    pintarMensaje('No se pudo cargar ' + ANALISIS_BASE_LOCAL + ', así que la búsqueda local no está disponible.');
    return;
  }

  const encontrados = buscarEnBaseLocal(base, texto);
  analisisEstado.textContent = 'Base local · ' + new Date().toLocaleTimeString('es-MX');

  if (encontrados.length === 0) {
    pintarMensaje('La base local tiene ' + base.length + ' registros y ninguno coincide con "' + texto + '".');
    return;
  }

  pintarLista(encontrados.map(registro => ({
    origen: 'Base local',
    probabilidad: null,
    nombre: registro.local_name || registro.name,
    descripcion: registro.description || '',
    causa: registro.cause || '',
    tratamiento: registro.treatment || {},
    url: registro.url || ''
  })), null);
}

btnAnalizarPlantas.addEventListener('click', analizarPlantas);
btnBuscarLocal.addEventListener('click', buscarLocal);
analisisBusqueda.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') buscarLocal();
});
