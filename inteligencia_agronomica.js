// AgroBot · Inteligencia agronómica local
//
// Cruza tres fuentes que la app YA tiene:
//   1) la foto del panel "Diagnóstico de planta" (análisis de color avanzado),
//   2) la última telemétrica del carrito BLE (suelo, temperatura, tanque...),
//   3) el clima de Open-Meteo cargado en el panel de clima.
//
// Además agrega dos entradas manuales que el usuario controla:
//   4) el tipo de planta (cada cultivo tiene sus propios umbrales),
//   5) las plagas observadas a simple vista.
//
// Todo se calcula aquí, en el navegador: sin API, sin llaves, sin internet.
//
// Mejoras de diagnóstico incluidas:
//   · Corrección de exposición (un factor igual para los tres canales), para
//     que una foto oscura o muy clara no se diagnostique mal sin alterar sus
//     colores.
//   · Historial de fotos y comparación contra la anterior, con las diferencias
//     de cada color explicadas.
//
// Cómo probarlo sin carrito: desde la consola del navegador se puede inyectar
// datos de ejemplo con window.agrobotImagenDemo (una Image o un dataURL) y
// window.agrobotTelemetriaDemo (un objeto con SUELO, TEMP, AGUA...).

(function () {
  // =========================================================
  // CATÁLOGOS
  // =========================================================

  // Cada perfil ajusta los umbrales del motor de reglas y aporta una nota de
  // manejo. "suelo" y "temp" son rangos [mínimo, máximo] cómodos para esa planta.
  const TIPOS_PLANTA = {
    generica: {
      nombre: 'Genérica (umbral estándar)',
      suelo: [30, 60], temp: [15, 32],
      nota: 'Perfil neutro para cualquier planta cuando no sabes qué sembraste.'
    },
    tomate: {
      nombre: 'Tomate',
      suelo: [50, 75], temp: [18, 30],
      nota: 'Riega la raíz, no el follaje: la humedad en la hoja le provoca hongos. En calor fuerte puede caerse la flor antes de cuajar el fruto.'
    },
    chile: {
      nombre: 'Chile',
      suelo: [40, 65], temp: [20, 32],
      nota: 'Aguanta bien el calor; el problema es el exceso de agua, que le pudre la raíz.'
    },
    albahaca: {
      nombre: 'Albahaca',
      suelo: [45, 70], temp: [18, 30],
      nota: 'Follaje tierno: se marchita en cuanto se seca el suelo y no siempre se recupera.'
    },
    maiz: {
      nombre: 'Maíz',
      suelo: [45, 70], temp: [18, 33],
      nota: 'Bebe mucha agua en floración; la sequía en esa etapa se paga en el rendimiento.'
    },
    frijol: {
      nombre: 'Frijol',
      suelo: [40, 65], temp: [16, 30],
      nota: 'Sensible al frío y a la humedad excesiva en floración.'
    },
    nopal: {
      nombre: 'Nopal / cactus',
      suelo: [10, 30], temp: [10, 38],
      nota: 'Planta xerófila: casi nunca necesita riego. El agua en exceso la pudre desde la base.'
    },
    orquidea: {
      nombre: 'Orquídea',
      suelo: [30, 55], temp: [18, 28],
      nota: 'Quiere humedad alta en el aire pero suelo aireado; el agua estancada en la raíz la mata.'
    }
  };

  // Lo que el usuario marca como observado a simple vista. Es una pista, no un
  // diagnóstico de laboratorio, por eso el peso es moderado.
  const PLAGAS = {
    ninguno: { nombre: 'No observo plagas', peso: 0,  accion: '' },
    pulgones: { nombre: 'Pulgones (insectos chupadores)', peso: -18, accion: 'Pulgón: lava con agua a presión o jabón potásico y revisa el envés de las hojas.' },
    hongos:   { nombre: 'Hongos / algodoncillo', peso: -22, accion: 'Hongo: deja de mojar el follaje, mejora la ventilación y aplica un fungicida de cobre.' },
    manchas:  { nombre: 'Manchas en las hojas', peso: -15, accion: 'Manchas: recorta las hojas afectadas y no las dejes caer sobre el suelo.' },
    orugas:   { nombre: 'Orugas / gusanos', peso: -15, accion: 'Orugas: revisa los brotes nuevos; Bacillus thuringiensis es un control biológico efectivo.' },
    aranas:   { nombre: 'Araña roja', peso: -15, accion: 'Araña roja: aparece con calor y sequedad; sube la humedad ambiental y usa acaricida.' }
  };

  // -------- Umbrales generales del motor --------
  const LLUVIA_POSPONER = 40;   // % de prob. de lluvia para posponer el riego
  const TANQUE_BAJO     = 20;   // % de agua restante en el tanque

  const CLAVE_HISTORICO = 'agrobot_evaluaciones';
  const CLAVE_FOTOS     = 'agrobot_fotos';
  const CLAVE_PERFIL    = 'agrobot_tipo_planta';
  const CLAVE_PLAGAS    = 'agrobot_plagas';
  const MAX_FOTOS       = 6;

  const el = (id) => document.getElementById(id);
  const btnEvaluar  = el('btnEvaluarPlanta');
  const iaEstado    = el('iaEstado');
  const iaResultado = el('iaResultado');

  if (!btnEvaluar || !iaEstado || !iaResultado) return;

  // =========================================================
  // 1) CORRECCIÓN DE ILUMINACIÓN
  // =========================================================
  // Ajusta el canvas antes de contar colores:
  //   · Balance de gris: si la foto tiene tinte (luz de atardecer, sombra
  //     azulada), iguala los canales para que "verde" sea verde de verdad.
  //   · Estiramiento de contraste por percentiles: si la foto está apagada o
  //     sobreexpuesta, estira el rango útil de tonos.
  // Así una foto tomada a contraluz no se diagnostica como amarillenta.
  // Ajusta la exposición de la foto antes de contar colores.
  //
  // Se aplica un único factor multiplicativo a los tres canales por igual. Así
  // se corrige una foto oscura o muy clara sin tocar el color: la saturación y
  // la relación entre canales quedan intactas, así que no se inventan ni se
  // borran matices.
  //
  // Lo que NO funciona (y se probó y se descartó):
  //   · Balance de blancos / "white patch": una hoja es lo más claro de la
  //     escena y es verde de verdad, así que le empuja el azul y arruina tanto
  //     el verde como los tonos café del suelo.
  //   · Estirar contraste canal por canal: dispara los canales hacia 0 o 255,
  //     convierte el verde sano en amarillo y borra las manchas oscuras.
  function normalizarIluminacion(ctx, lado) {
    const datos = ctx.getImageData(0, 0, lado, lado);
    const p = datos.data;

    const brillos = [];
    for (let i = 0; i < p.length; i += 4) {
      const brillo = (p[i] + p[i + 1] + p[i + 2]) / 3;
      if (brillo < 12 || brillo > 248) continue; // ignora fondo
      brillos.push(brillo);
    }
    if (brillos.length < 50) return; // casi sin contenido, nada que corregir

    brillos.sort((a, b) => a - b);
    const mediana = brillos[Math.floor(brillos.length / 2)];

    // objetivo de brillo medio; acotado para no forzar demasiado la imagen
    const BRILLO_OBJETIVO = 110;
    const factor = Math.max(0.7, Math.min(1.6, BRILLO_OBJETIVO / mediana));
    if (Math.abs(factor - 1) < 0.05) return; // ya tiene buena exposición

    for (let i = 0; i < p.length; i += 4) {
      p[i]     = Math.max(0, Math.min(255, p[i]     * factor));
      p[i + 1] = Math.max(0, Math.min(255, p[i + 1] * factor));
      p[i + 2] = Math.max(0, Math.min(255, p[i + 2] * factor));
    }
    ctx.putImageData(datos, 0, 0);
  }

  // =========================================================
  // 2) ANÁLISIS DE COLOR AVANZADO DE LA FOTO
  // =========================================================
  // Separa verde sano, verde pálido (estrés hídrico o falta de luz), amarillo
  // (falta de nutrientes), café/seco (tejido muerto) y manchas oscuras (posible
  // hongo o necrosis).
  //
  // Las reglas usan saturación y relaciones entre canales, nunca valores
  // absolutos de brillo. Así el resultado no depende de si la foto salió
  // oscura, clara o con luz cálida, y no se contradice con la corrección de
  // iluminación que se aplica justo antes.
  function analizarFoto(img) {
    const L = 120; // lado del cuadro de muestreo
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = L;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, L, L);
    normalizarIluminacion(ctx, L);

    const p = ctx.getImageData(0, 0, L, L).data;

    // primera pasada: brillo mediano de la escena (referencia relativa)
    const brillos = [];
    for (let i = 0; i < p.length; i += 4) {
      const brillo = (p[i] + p[i + 1] + p[i + 2]) / 3;
      if (brillo < 12 || brillo > 248) continue;
      brillos.push(brillo);
    }
    if (brillos.length < 50) {
      return { hoja: 0, sano: 0, palido: 0, amarillo: 0, seco: 0, mancha: 0 };
    }
    brillos.sort((a, b) => a - b);
    const mediana = brillos[Math.floor(brillos.length / 2)];
    // una mancha es lo que se ve mucho más oscuro que el resto de la hoja
    const umbralMancha = mediana * 0.45;

    let sano = 0, palido = 0, amarillo = 0, seco = 0, mancha = 0, hoja = 0;

    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const brillo = (r + g + b) / 3;
      if (brillo < 12 || brillo > 248) continue; // ignora fondo

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturacion = max === 0 ? 0 : (max - min) / max;

      hoja++;

      // oscuro respecto a la escena y poco saturado -> mancha / necrosis
      if (brillo < umbralMancha && saturacion < 0.4) { mancha++; continue; }

      if (g > r * 1.05 && g > b * 1.1) {          // verde dominante
        // verde apagado (lavado) vs verde vivo: la saturación no cambia con la
        // exposición, así que sirve para distinguirlos en cualquier foto
        if (saturacion < 0.32) palido++;
        else sano++;
      } else if (r > b * 1.15 && g > b * 1.05) {  // tono tierra (amarillo/café)
        // el amarillo tiene el verde casi tan alto como el rojo; el café no
        if (g > r * 0.72) amarillo++;
        else seco++;
      }
    }

    const pct = (n) => (hoja ? Math.round((n / hoja) * 100) : 0);
    return {
      hoja,
      sano: pct(sano), palido: pct(palido),
      amarillo: pct(amarillo), seco: pct(seco), mancha: pct(mancha)
    };
  }

  // Mensaje corto para el panel de diagnóstico. El orden va por severidad, no
  // por orden de aparición: un poco de café en el encuadre suele ser suelo, no
  // hoja dañada, así que no debe tapar el veredicto de una planta sana.
  function mensajeBasico(m) {
    if (m.hoja < 50) {
      return 'No se detectó suficiente follaje en la foto. Acércate más a la planta e intenta de nuevo.';
    }
    if (m.mancha >= 8) {
      return `Posible hongo o necrosis — ${m.mancha}% del follaje con manchas oscuras. Revisa las hojas afectadas.`;
    }
    if (m.amarillo >= 30) {
      return `Estrés — ~${m.amarillo}% amarillento contra ${m.sano}% verde. Revisa nutrición y riego.`;
    }
    if (m.sano >= 60) {
      return `Se ve saludable — ~${m.sano}% del follaje detectado es verde sano.`;
    }
    if (m.seco >= 15) {
      return `Tejido seco/marchito — ${m.seco}% café. Revisa riego (puede ser exceso o falta).`;
    }
    return `Estado regular — ${m.sano}% verde sano, ${m.amarillo}% amarillo, ${m.palido}% verde pálido.`;
  }

  // =========================================================
  // 3) HISTORIAL DE FOTOS + COMPARACIÓN CON LA ANTERIOR
  // =========================================================
  function miniatura(img) {
    const L = 96;
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = L;
    const ctx = canvas.getContext('2d');
    // recorte cuadrado centrado, para que las comparaciones sean del mismo marco
    const lado = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, L, L);
    return canvas.toDataURL('image/jpeg', 0.6);
  }

  function leerFotos() {
    try { return JSON.parse(localStorage.getItem(CLAVE_FOTOS)) || []; } catch (e) { return []; }
  }

  function registrarFoto(img, metricas) {
    const fotos = leerFotos();
    const anterior = fotos[fotos.length - 1] || null;

    fotos.push({ fecha: Date.now(), metricas, mini: miniatura(img) });
    while (fotos.length > MAX_FOTOS) fotos.shift();
    try { localStorage.setItem(CLAVE_FOTOS, JSON.stringify(fotos)); } catch (e) {}

    pintarComparacion(anterior, { fecha: Date.now(), metricas, mini: miniatura(img) });
    return anterior;
  }

  function pintarComparacion(anterior, actual) {
    const caja = el('comparacionFoto');
    if (!caja) return;

    if (!anterior) {
      caja.innerHTML = '<p class="hint" style="margin-top:0;">Primera foto registrada. La próxima se comparará contra esta.</p>';
      caja.style.display = 'block';
      return;
    }

    const fila = (etiqueta, clave) => {
      const a = anterior.metricas[clave], b = actual.metricas[clave];
      const delta = b - a;
      const color = delta === 0 ? 'inherit' : (clave === 'sano' ? (delta > 0 ? '#4ade80' : '#f87171') : (delta > 0 ? '#f87171' : '#4ade80'));
      const marca = delta === 0 ? 'sin cambio' : (delta > 0 ? `+${delta}` : `${delta}`);
      return `<tr>
        <td style="padding:3px 8px 3px 0;">${etiqueta}</td>
        <td style="padding:3px 8px; text-align:right;">${a}%</td>
        <td style="padding:3px 8px; text-align:right;">${b}%</td>
        <td style="padding:3px 0 3px 8px; text-align:right; color:${color};">${marca}</td>
      </tr>`;
    };

    const dias = Math.max(0, Math.round((Date.now() - anterior.fecha) / 86400000));
    const a = anterior.metricas, b = actual.metricas;
    let veredicto;
    if (b.sano > a.sano + 5) veredicto = 'La planta mejoró: el follaje sano creció.';
    else if (b.sano < a.sano - 5) veredicto = 'La planta empeoró: hay menos follaje sano que en la foto anterior.';
    else if (b.mancha > a.mancha + 5) veredicto = 'Aparecieron más manchas oscuras que en la foto anterior.';
    else veredicto = 'No cambió mucho respecto a la foto anterior.';

    caja.innerHTML = `
      <div class="metric-label" style="margin-bottom:8px;">Comparación con la foto anterior (hace ${dias} día(s))</div>
      <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
        <div style="text-align:center;">
          <img src="${anterior.mini}" alt="foto anterior" style="width:110px; height:110px; object-fit:cover; border-radius:8px; border:1px solid var(--soil-700);">
          <div class="control-sub" style="margin-top:4px;">Anterior</div>
        </div>
        <div style="text-align:center;">
          <img src="${actual.mini}" alt="foto actual" style="width:110px; height:110px; object-fit:cover; border-radius:8px; border:1px solid var(--soil-700);">
          <div class="control-sub" style="margin-top:4px;">Actual</div>
        </div>
        <table style="border-collapse:collapse; font-family:var(--font-mono); font-size:12px; flex:1; min-width:240px;">
          <thead>
            <tr style="opacity:0.6;">
              <th style="text-align:left; padding-bottom:6px; font-weight:normal;">Color</th>
              <th style="text-align:right; padding-bottom:6px; font-weight:normal;">Antes</th>
              <th style="text-align:right; padding-bottom:6px; font-weight:normal;">Ahora</th>
              <th style="text-align:right; padding-bottom:6px; font-weight:normal;">Δ</th>
            </tr>
          </thead>
          <tbody>
            ${fila('Verde sano', 'sano')}
            ${fila('Verde pálido', 'palido')}
            ${fila('Amarillo', 'amarillo')}
            ${fila('Seco / café', 'seco')}
            ${fila('Manchas', 'mancha')}
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px;">${veredicto}</p>`;
    caja.style.display = 'block';
  }

  // =========================================================
  // 4) MOTOR DE REGLAS: índice de salud + factores + acciones
  // =========================================================
  function evaluar(foto, tel, clima, perfil, plagas) {
    let indice = 100;
    const factores = [];   // { texto, peso }  (explica el número)
    const acciones = [];
    const avisos = [];     // faltan datos para algo

    const sueloMin = perfil.suelo[0], sueloMax = perfil.suelo[1];
    const tempBaja = perfil.temp[0],  tempAlta  = perfil.temp[1];

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

    // ---- Fuente 2: sensores del carrito (umbrales según la planta elegida) ----
    if (tel) {
      const suelo = parseInt(tel.SUELO);
      if (!isNaN(suelo)) {
        if (suelo < sueloMin) {
          indice -= 20;
          factores.push({ texto: `Suelo muy seco (${suelo}%, y a esta planta le va bien desde ${sueloMin}%)`, peso: -20 });
        } else if (suelo > sueloMax) {
          indice -= 8;
          factores.push({ texto: `Suelo con exceso de humedad (${suelo}%, a esta planta le va bien hasta ${sueloMax}%)`, peso: -8 });
          acciones.push('Deja de regar un rato: el suelo está por encima de lo cómodo para esta planta y el encharcamiento pudre la raíz.');
        } else {
          factores.push({ texto: `Suelo en su rango ideal para la planta (${suelo}%)`, peso: 0 });
        }
      }

      const temp = parseFloat(tel.TEMP);
      if (!isNaN(temp)) {
        if (temp >= tempAlta) {
          indice -= 10;
          factores.push({ texto: `Calor alto (${temp}°C, y a esta planta le va bien hasta ${tempAlta}°C)`, peso: -10 });
          acciones.push('En horas pico da sombra parcial o ventila para bajar la temperatura.');
        } else if (temp <= tempBaja) {
          indice -= 10;
          factores.push({ texto: `Frío (${temp}°C, por debajo del mínimo de ${tempBaja}°C)`, peso: -10 });
          acciones.push('Protege la planta del frío nocturno.');
        } else {
          factores.push({ texto: `Temperatura adecuada para la planta (${temp}°C)`, peso: 0 });
        }
      }

      const agua = parseInt(tel.AGUA);
      if (!isNaN(agua) && agua < TANQUE_BAJO) {
        factores.push({ texto: `Tanque de agua casi vacío (${agua}%)`, peso: 0 });
        acciones.push('Recarga el tanque antes de encender el riego automático.');
      }

      if (!isNaN(suelo) && suelo < sueloMin) {
        if (clima && clima.probLluviaHoy >= LLUVIA_POSPONER) {
          acciones.push(`No riegues todavía: hay ${clima.probLluviaHoy}% de probabilidad de lluvia hoy.`);
        } else {
          acciones.push('Activa la bomba de riego: el suelo está por debajo del umbral de esta planta.');
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
      if (clima.probLluviaHoy < 20 && clima.tempExterior > tempAlta) {
        factores.push({ texto: `Día soleado y seco (${clima.tempExterior}°C, lluvia ${clima.probLluviaHoy}%) — la planta va a pedir agua`, peso: -5 });
        indice -= 5;
      }
    } else {
      avisos.push('Sin clima: activa "Usar mi ubicación" para que las recomendaciones de riego contemplen la lluvia.');
    }

    // ---- Fuente 4: plagas observadas por el usuario ----
    Object.keys(plagas).forEach((clave) => {
      const p = PLAGAS[clave];
      if (!p || p.peso === 0) return;
      indice += p.peso;
      factores.push({ texto: `Peste observada: ${p.nombre}`, peso: p.peso });
      if (p.accion) acciones.push(p.accion);
    });

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
  // 5) TENDENCIA: compara el índice con la evaluación anterior
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
  // 6) INTERFAZ: selector de planta, plagas, resultado
  // =========================================================

  // -- Selector de tipo de planta --
  const selectPlanta = el('iaTipoPlanta');
  const guiaPlanta   = el('iaGuiaPlanta');

  function pintarGuia() {
    if (!guiaPlanta || !selectPlanta) return;
    const perfil = TIPOS_PLANTA[selectPlanta.value] || TIPOS_PLANTA.generica;
    guiaPlanta.innerHTML = `
      <b style="color:var(--text-100);">${perfil.nombre}</b> —
      suelo cómodo entre ${perfil.suelo[0]} y ${perfil.suelo[1]}%,
      temperatura entre ${perfil.temp[0]} y ${perfil.temp[1]}°C.<br>
      <span style="opacity:0.8;">${perfil.nota}</span>`;
    guiaPlanta.style.display = 'block';
  }

  if (selectPlanta) {
    Object.keys(TIPOS_PLANTA).forEach((clave) => {
      const opcion = document.createElement('option');
      opcion.value = clave;
      opcion.textContent = TIPOS_PLANTA[clave].nombre;
      selectPlanta.appendChild(opcion);
    });
    // recuerda la última elección
    const guardado = localStorage.getItem(CLAVE_PERFIL);
    if (guardado && TIPOS_PLANTA[guardado]) selectPlanta.value = guardado;
    selectPlanta.addEventListener('change', () => {
      localStorage.setItem(CLAVE_PERFIL, selectPlanta.value);
      pintarGuia();
    });
    pintarGuia();
  }

  // -- Casillas de plagas observadas --
  const cajaPlagas = el('iaPlagas');

  function leerPlagas() {
    const marcadas = {};
    if (cajaPlagas) {
      cajaPlagas.querySelectorAll('input[type="checkbox"]:checked').forEach((c) => {
        if (c.value !== 'ninguno') marcadas[c.value] = true;
      });
    }
    return marcadas;
  }

  if (cajaPlagas) {
    Object.keys(PLAGAS).forEach((clave) => {
      const etiqueta = document.createElement('label');
      etiqueta.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; font-family:var(--font-mono); font-size:12px;';
      etiqueta.innerHTML = `<input type="checkbox" value="${clave}" style="accent-color:#4ade80;"> ${PLAGAS[clave].nombre}`;
      cajaPlagas.appendChild(etiqueta);
    });

    // "No observo plagas" desmarca el resto, y viceversa
    cajaPlagas.addEventListener('change', (e) => {
      const c = e.target;
      const todas = [...cajaPlagas.querySelectorAll('input[type="checkbox"]')];
      if (c.value === 'ninguno' && c.checked) {
        todas.forEach((t) => { if (t.value !== 'ninguno') t.checked = false; });
      } else if (c.value !== 'ninguno' && c.checked) {
        const ninguno = todas.find((t) => t.value === 'ninguno');
        if (ninguno) ninguno.checked = false;
      }
    });
  }

  function contexto() {
    // Los overrides de window permiten probar el motor con datos de ejemplo
    // desde la consola, sin tener el carrito encendido.
    return {
      imagen: window.agrobotImagenDemo || null,
      telemetria: window.agrobotTelemetriaDemo || window.__ultimaTelemetria || null,
      clima: window.__climaActual || null
    };
  }

  function pintar(foto, r, tendencia, perfil, plagas) {
    let html = '';

    html += `<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
      <span style="display:inline-block; padding:6px 12px; border-radius:8px; background:${r.color}22; border:1px solid ${r.color}; color:${r.color}; font-family:var(--font-mono); font-size:13px;">${r.nivel}</span>
      <span style="font-family:var(--font-mono); font-size:22px;">Índice de salud: ${r.indice}/100</span>
    </div>`;

    html += `<div style="height:10px; border-radius:6px; background:var(--soil-800); border:1px solid var(--soil-700); margin-top:10px; overflow:hidden;">
      <div style="height:100%; width:${r.indice}%; background:${r.color};"></div>
    </div>`;

    html += `<p class="hint" style="margin-top:10px;">Planta evaluada: <b style="color:var(--text-100);">${perfil.nombre}</b>. ${tendencia}</p>`;

    if (foto) {
      html += `<p class="hint" style="margin-top:6px;">Follaje detectado (con exposición corregida) — verde sano ${foto.sano}%, verde pálido ${foto.palido}%, amarillo ${foto.amarillo}%, seco ${foto.seco}%, manchas ${foto.mancha}%.</p>`;
    }

    const claves = Object.keys(plagas);
    if (claves.length > 0) {
      html += `<p class="hint" style="margin-top:6px;">Plagas marcadas: ${claves.map((c) => PLAGAS[c].nombre).join(', ')}.</p>`;
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

    const perfil = TIPOS_PLANTA[selectPlanta ? selectPlanta.value : 'generica'] || TIPOS_PLANTA.generica;
    const plagas = leerPlagas();

    const evaluarConFoto = (img) => {
      const foto = img ? analizarFoto(img) : null;
      const r = evaluar(foto, ctx.telemetria, ctx.clima, perfil, plagas);
      const tendencia = guardarTendencia(r);
      pintar(foto, r, tendencia, perfil, plagas);
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

  // =========================================================
  // 7) API PÚBLICA PARA EL PANEL DE DIAGNÓSTICO
  // =========================================================
  // El botón "Analizar" del panel de diagnóstico usa estas funciones para que
  // el análisis de color y la comparación de fotos vivan en un solo lugar.
  window.AgrobotDiagnostico = {
    analizar: analizarFoto,
    mensaje: mensajeBasico,
    registrarFoto: registrarFoto
  };
})();
