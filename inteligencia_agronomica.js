// AgroBot · Inteligencia agronómica local
//
// Cruza tres fuentes que la app YA tiene:
//   1) la foto del panel "Diagnóstico de planta" (análisis de color avanzado),
//   2) la última telemétrica del carrito BLE (suelo, temperatura, tanque, aire...),
//   3) el clima de Open-Meteo cargado en el panel de clima.
//
// Todo se calcula aquí, en el navegador: sin API, sin llaves, sin internet.
// La salida es un índice de salud 0-100 con la lista de factores que lo
// movieron (para que se vea CÓMO llegó al número) y acciones recomendadas.
//
// Cómo probarlo sin carrito: desde la consola del navegador se puede inyectar
// datos de ejemplo con window.agrobotImagenDemo (una Image) y
// window.agrobotTelemetriaDemo (un objeto con SUELO, TEMP, AGUA...).

(function () {
  // -------- Umbrales del motor de reglas --------
  const UMBRAL_SUELO_SECO = 30;    // % de humedad del suelo para sugerir riego
  const UMBRAL_SUELO_OK   = 60;    // % a partir del cual el suelo se considera bien
  const TEMP_ALTA         = 35;    // °C, estrés por calor
  const TEMP_BAJA         = 12;    // °C, estrés por frío
  const LLUVIA_POSPONER   = 40;    // % de prob. de lluvia para posponer el riego
  const TANQUE_BAJO       = 20;    // % de agua restante en el tanque

  const CLAVE_HISTORICO = 'agrobot_evaluaciones';

  const el = (id) => document.getElementById(id);
  const btnEvaluar   = el('btnEvaluarPlanta');
  const iaEstado     = el('iaEstado');
  const iaResultado  = el('iaResultado');

  if (!btnEvaluar || !iaEstado || !iaResultado) return;

  // =========================================================
  // 1) ANÁLISIS DE COLOR AVANZADO DE LA FOTO
  // =========================================================
  // Va más allá del "verde vs amarillo" del diagnóstico básico: separa
  // verde sano, verde pálido (estrés hídrico o falta de luz), amarillo
  // (falta de nutrientes), café/seco (tejido muerto) y manchas oscuras
  // (posible hongo o necrosis).
  function analizarFoto(img) {
    const L = 120; // lado del cuadro de muestreo
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = L;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, L, L);
    const p = ctx.getImageData(0, 0, L, L).data;

    let sano = 0, palido = 0, amarillo = 0, seco = 0, mancha = 0, hoja = 0;

    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const brillo = (r + g + b) / 3;
      if (brillo < 20 || brillo > 245) continue; // ignora fondo muy oscuro/claro

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturacion = max === 0 ? 0 : (max - min) / max;

      hoja++;

      // oscuro y poco saturado -> posible mancha / necrosis
      if (brillo < 55 && saturacion < 0.35) { mancha++; continue; }

      if (g > r * 1.05 && g > b * 1.1) {              // verde dominante
        if (saturacion < 0.22 || g < 110) palido++;   // verde apagado
        else sano++;
      } else if (r > b * 1.15 && g > b * 1.05) {      // tono tierra (amarillo/café)
        if (r > 160 && g > 120) amarillo++;           // amarillo brillante
        else seco++;                                  // café, tejido seco
      }
    }

    const pct = (n) => (hoja ? Math.round((n / hoja) * 100) : 0);
    return { hoja, sano: pct(sano), palido: pct(palido), amarillo: pct(amarillo), seco: pct(seco), mancha: pct(mancha) };
  }

  // =========================================================
  // 2) MOTOR DE REGLAS: índice de salud + factores + acciones
  // =========================================================
  function evaluar(foto, tel, clima) {
    let indice = 100;
    const factores = [];   // { texto, peso }  (explica el número)
    const acciones = [];
    const avisos = [];     // faltan datos para algo

    // ---- Fuente 1: la foto ----
    if (foto) {
      if (foto.mancha >= 8) {
        indice -= 30;
        factores.push({ texto: `Manchas oscuras detectadas (${foto.mancha}% del follaje) — posible hongo o necrosis`, peso: -30 });
        acciones.push('Revisa las hojas con mancha: recórtalas, mejora la ventilación y evita mojar el follaje al regar.');
      }
      if (foto.seco >= 15) {
        indice -= 25;
        factores.push({ texto: `Tejido café/seco (${foto.seco}%) — parte de la hoja ya no se recupera`, peso: -25 });
        acciones.push('Poda las hojas secas y revisa si el estrés viene de riego excesivo o falta de agua.');
      }
      if (foto.amarillo >= 30) {
        indice -= 20;
        factores.push({ texto: `Amarillamiento generalizado (${foto.amarillo}%) — falta de nutrientes o riego`, peso: -20 });
        acciones.push('Revisa la nutrición (nitrógeno) y el riego antes de fertilizar.');
      }
      if (foto.palido >= 25) {
        indice -= 10;
        factores.push({ texto: `Verde pálido (${foto.palido}%) — estrés hídrico o poca luz`, peso: -10 });
        acciones.push('El follaje se ve lavado: revisa que no esté con exceso de agua y acércalo a más luz.');
      }
      if (foto.sano >= 60 && factores.length === 0) {
        factores.push({ texto: `Follaje verde sano (${foto.sano}% de píxeles sanos)`, peso: 0 });
      }
      if (foto.hoja < 50) {
        avisos.push('La foto no tiene follaje suficiente para un análisis confiable.');
      }
    } else {
      avisos.push('Sin foto: el análisis se basa solo en sensores y clima. Toma una foto desde el panel de diagnóstico.');
    }

    // ---- Fuente 2: sensores del carrito ----
    if (tel) {
      const suelo = parseInt(tel.SUELO);
      if (!isNaN(suelo)) {
        if (suelo < UMBRAL_SUELO_SECO) {
          indice -= 20;
          factores.push({ texto: `Suelo muy seco (${suelo}%)`, peso: -20 });
        } else if (suelo < UMBRAL_SUELO_OK) {
          indice -= 8;
          factores.push({ texto: `Suelo con humedad baja-media (${suelo}%)`, peso: -8 });
        } else {
          factores.push({ texto: `Suelo bien húmedo (${suelo}%)`, peso: 0 });
        }
      }

      const temp = parseFloat(tel.TEMP);
      if (!isNaN(temp)) {
        if (temp >= TEMP_ALTA) {
          indice -= 10;
          factores.push({ texto: `Calor alto en el invernadero (${temp}°C)`, peso: -10 });
          acciones.push('En horas pico da sombra parcial o ventila para bajar la temperatura.');
        } else if (temp <= TEMP_BAJA) {
          indice -= 10;
          factores.push({ texto: `Frío (${temp}°C) por debajo del rango cómodo`, peso: -10 });
          acciones.push('Protege la planta del frío nocturno.');
        } else {
          factores.push({ texto: `Temperatura adecuada (${temp}°C)`, peso: 0 });
        }
      }

      const agua = parseInt(tel.AGUA);
      if (!isNaN(agua) && agua < TANQUE_BAJO) {
        factores.push({ texto: `Tanque de agua casi vacío (${agua}%)`, peso: 0 });
        acciones.push('Recarga el tanque antes de encender el riego automático.');
      }

      const sueloSeco = !isNaN(suelo) && suelo < UMBRAL_SUELO_SECO;
      if (sueloSeco) {
        if (clima && clima.probLluviaHoy >= LLUVIA_POSPONER) {
          acciones.push(`No riegues todavía: hay ${clima.probLluviaHoy}% de probabilidad de lluvia hoy.`);
        } else {
          acciones.push('Activa la bomba de riego: el suelo está por debajo del umbral.');
        }
      }
    } else {
      avisos.push('Sin sensores: conecta el carrito por Bluetooth para cruzar humedad del suelo y temperatura.');
    }

    // ---- Fuente 3: clima ----
    if (clima) {
      if (clima.probLluviaHoy >= 60) {
        factores.push({ texto: `Lluvia probable hoy (${clima.probLluviaHoy}%) — el riego se puede ahorrar`, peso: 0 });
      }
      if (clima.probLluviaHoy < 20 && clima.tempExterior > TEMP_ALTA) {
        factores.push({ texto: `Día soleado y seco (${clima.tempExterior}°C, lluvia ${clima.probLluviaHoy}%) — la planta va a pedir agua`, peso: -5 });
        indice -= 5;
      }
    } else {
      avisos.push('Sin clima: activa "Usar mi ubicación" para que las recomendaciones de riego contemplen la lluvia.');
    }

    indice = Math.max(0, Math.min(100, indice));

    let nivel, color;
    if (indice >= 85)      { nivel = 'Excelente';  color = '#4ade80'; }
    else if (indice >= 70) { nivel = 'Buena';      color = '#a3e635'; }
    else if (indice >= 50) { nivel = 'Estrés leve';    color = '#fbbf24'; }
    else if (indice >= 30) { nivel = 'Estrés moderado'; color = '#fb923c'; }
    else                   { nivel = 'Riesgo crítico'; color = '#f87171'; }

    if (acciones.length === 0 && indice >= 70) {
      acciones.push('Todo se ve bien: mantén el riego automático y toma una foto cada semana para seguimiento.');
    }

    return { indice, nivel, color, factores, acciones, avisos };
  }

  // =========================================================
  // 3) TENDENCIA: compara con la evaluación anterior
  // =========================================================
  function guardarTendencia(resultado) {
    let historico = [];
    try { historico = JSON.parse(localStorage.getItem(CLAVE_HISTORICO)) || []; } catch (e) {}
    const anterior = historico[historico.length - 1] || null;

    historico.push({ fecha: Date.now(), indice: resultado.indice });
    if (historico.length > 30) historico = historico.slice(-30);
    localStorage.setItem(CLAVE_HISTORICO, JSON.stringify(historico));

    if (!anterior) return 'Primera evaluación registrada. La próxima comparará contra esta.';
    const dias = Math.max(0, Math.round((Date.now() - anterior.fecha) / 86400000));
    const delta = resultado.indice - anterior.indice;
    if (delta === 0) return `Igual que la evaluación anterior (hace ${dias} día(s)).`;
    if (delta > 0)   return `Subió ${delta} puntos respecto a la evaluación anterior (hace ${dias} día(s)).`;
    return `Bajó ${Math.abs(delta)} puntos respecto a la evaluación anterior (hace ${dias} día(s)). ¡Vale la revisarla!`;
  }

  // =========================================================
  // 4) INTERFAZ
  // =========================================================
  function contexto() {
    // Los overrides de window permiten probar el motor con datos de ejemplo
    // desde la consola, sin tener el carrito encendido.
    return {
      imagen: window.agrobotImagenDemo || null,
      telemetria: window.agrobotTelemetriaDemo || window.__ultimaTelemetria || null,
      clima: window.__climaActual || null
    };
  }

  function pintar(foto, r, tendencia) {
    let html = '';

    html += `<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
      <span style="display:inline-block; padding:6px 12px; border-radius:8px; background:${r.color}22; border:1px solid ${r.color}; color:${r.color}; font-family:var(--font-mono); font-size:13px;">${r.nivel}</span>
      <span style="font-family:var(--font-mono); font-size:22px;">Índice de salud: ${r.indice}/100</span>
    </div>`;

    html += `<div style="height:10px; border-radius:6px; background:var(--soil-800); border:1px solid var(--soil-700); margin-top:10px; overflow:hidden;">
      <div style="height:100%; width:${r.indice}%; background:${r.color};"></div>
    </div>`;

    html += `<p class="hint" style="margin-top:10px;">${tendencia}</p>`;

    if (foto) {
      html += `<p class="hint" style="margin-top:6px;">Follaje detectado en la foto — verde sano ${foto.sano}%, verde pálido ${foto.palido}%, amarillo ${foto.amarillo}%, seco ${foto.seco}%, manchas ${foto.mancha}%.</p>`;
    }

    html += '<div style="margin-top:14px;"><div class="metric-label">Factores que definieron el índice</div>';
    if (r.factores.length === 0) {
      html += '<p class="hint" style="margin-top:4px;">Sin datos suficientes para detallar factores.</p>';
    } else {
      html += '<ul style="margin:6px 0 0 18px; padding:0; font-family:var(--font-mono); font-size:12px;">';
      r.factores.forEach((f) => {
        const marca = f.peso < 0 ? `${f.peso}` : (f.peso > 0 ? `+${f.peso}` : '0');
        html += `<li style="margin-bottom:4px;">${f.texto} <span style="opacity:0.6;">(${marca} pts)</span></li>`;
      });
      html += '</ul>';
    }
    html += '</div>';

    html += '<div style="margin-top:14px;"><div class="metric-label">Acciones recomendadas</div>';
    html += '<ul style="margin:6px 0 0 18px; padding:0; font-family:var(--font-mono); font-size:12px;">';
    r.acciones.forEach((a) => { html += `<li style="margin-bottom:4px;">${a}</li>`; });
    html += '</ul></div>';

    if (r.avisos.length > 0) {
      html += '<div style="margin-top:14px;"><div class="metric-label">Faltan datos</div>';
      html += '<ul style="margin:6px 0 0 18px; padding:0; font-family:var(--font-mono); font-size:12px; opacity:0.8;">';
      r.avisos.forEach((a) => { html += `<li style="margin-bottom:4px;">${a}</li>`; });
      html += '</ul></div>';
    }

    iaResultado.innerHTML = html;
    iaResultado.style.display = 'block';
  }

  btnEvaluar.addEventListener('click', () => {
    const ctx = contexto();

    // Si la app tiene una foto cargada en el diagnóstico, úsala directo
    const fuenteImagen = ctx.imagen || window.__imagenDiagnostico || null;

    if (!fuenteImagen && !ctx.telemetria && !ctx.clima) {
      iaResultado.style.display = 'block';
      iaResultado.innerHTML = '<p class="hint" style="margin-top:0;">No hay nada que evaluar todavía: toma una foto en el panel de diagnóstico, o conecta el carrito, o activa el clima.</p>';
      return;
    }

    iaEstado.textContent = 'Evaluando...';

    const evaluarConFoto = (img) => {
      const foto = img ? analizarFoto(img) : null;
      const r = evaluar(foto, ctx.telemetria, ctx.clima);
      const tendencia = guardarTendencia(r);
      pintar(foto, r, tendencia);
      iaEstado.textContent = 'Evaluación lista · ' + new Date().toLocaleTimeString('es-MX');
    };

    // Si la imagen viene como dataURL (demo), conviértela a Image primero
    if (typeof fuenteImagen === 'string') {
      const img = new Image();
      img.onload = () => evaluarConFoto(img);
      img.src = fuenteImagen;
    } else {
      evaluarConFoto(fuenteImagen);
    }
  });
})();
