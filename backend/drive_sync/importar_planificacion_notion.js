// Carga inicial de Planificación (public/api/planificacion.php) con lo que
// Álvaro tenía en la base "Seguimiento Obras" de Notion — a pedido de
// Álvaro, 2026-09-29. Se corre UNA vez (es idempotente igual: las tareas se
// identifican por su id de Notion y no se duplican si se vuelve a correr).
//
// El panel no tiene acceso a Notion, así que la exportación se hace aparte
// y llega en archivos de texto, una fila de Notion por línea, con los campos
// separados por "¦":
//   Proyecto¦Constructora¦Tarea¦Estado¦Inicio¦Fin¦Responsables¦Situación¦Tipo¦Silicona¦Comentario¦IdNotion
// (los archivos NO se suben al repo: los comentarios tienen teléfonos y
// correos de clientes).
//
// Cada Proyecto+Constructora pasa a ser una obra de planificación con sus
// tareas. Las categorías de Notion se traducen a las del panel ("General" es
// Montaje). Una obra queda "Terminada" si todo su montaje está terminado y
// no le queda facturación pendiente — el resto de las tareas viejas que en
// Notion quedaron en "Pendiente" sin tildar se importan tal cual.
//
// Uso:
//   node importar_planificacion_notion.js <archivo.txt> [más archivos…] [--dry-run]
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const CATEGORIAS = {
  'Medición': 'Medición',
  Material: 'Material',
  Fabricacion: 'Fabricación',
  Fabricar: 'Fabricación',
  Chapas: 'Chapas',
  Composite: 'Composite',
  Transporte: 'Transporte',
  Grua: 'Grúa',
  General: 'Montaje',
  Facturar: 'Facturar',
};
const ESTADOS_TERMINADOS = ['Terminado', 'Archivar'];
const FACTURACION_ABIERTA = ['Pendiente', 'Sin Asignar Fecha', 'Pendiente de Alvaro', 'Para Facturar', 'Frcion Mensual', 'Regalar'];

function masFrecuente(valores) {
  const conteo = new Map();
  for (const v of valores.filter(Boolean)) conteo.set(v, (conteo.get(v) || 0) + 1);
  return [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function leerFilas(archivos) {
  const filas = [];
  const vistos = new Set();
  for (const archivo of archivos) {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      if (!linea.trim()) continue;
      const c = linea.split('¦');
      if (c.length !== 12) throw new Error(`Línea con ${c.length} campos (se esperaban 12) en ${archivo}: ${linea}`);
      const [proyecto, constructora, tarea, estado, inicio, fin, responsables, situacion, tipo, silicona, comentario, id] = c.map((x) => x.trim());
      if (vistos.has(id)) continue;
      vistos.add(id);
      // Algunas fechas de Notion vienen con hora ("2026-05-05 07:00:00Z"):
      // en el panel las tareas son por día.
      filas.push({ proyecto, constructora, tarea, estado, inicio: inicio.slice(0, 10), fin: fin.slice(0, 10), responsables, situacion, tipo, silicona, comentario, id });
    }
  }
  return filas;
}

function armarObras(filas) {
  const porObra = new Map();
  for (const f of filas) {
    const clave = `${f.proyecto}¦${f.constructora}`;
    if (!porObra.has(clave)) porObra.set(clave, []);
    porObra.get(clave).push(f);
  }

  const obras = [];
  for (const grupo of porObra.values()) {
    const montajes = grupo.filter((f) => f.tarea === 'General').sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''));
    const montajeTerminado = montajes.length > 0 && montajes.every((f) => ESTADOS_TERMINADOS.includes(f.estado));
    const facturacionAbierta = grupo.some((f) => f.tarea === 'Facturar' && FACTURACION_ABIERTA.includes(f.estado));

    obras.push({
      nombre: grupo[0].proyecto,
      constructora: grupo[0].constructora || null,
      tipo: masFrecuente(grupo.map((f) => f.tipo)),
      situacion: montajes[0]?.situacion || masFrecuente(grupo.map((f) => f.situacion)),
      silicona: montajes.find((f) => f.silicona && f.silicona !== '?')?.silicona
        || masFrecuente(grupo.map((f) => (f.silicona === '?' ? '' : f.silicona))),
      estado: montajeTerminado && !facturacionAbierta ? 'Terminada' : 'Activa',
      tareas: grupo.map((f) => {
        // Estados de Notion que no son Pendiente/Terminado (Para Facturar,
        // Fracción Mensual, Regalar…) se conservan al principio del comentario.
        const extra = !['Pendiente', ...ESTADOS_TERMINADOS].includes(f.estado) ? `[${f.estado}] ` : '';
        return {
          notion_id: f.id,
          categoria: CATEGORIAS[f.tarea] || 'Varios',
          fecha_inicio: f.inicio || null,
          fecha_fin: f.fin && f.fin !== f.inicio ? f.fin : null,
          responsable: f.responsables ? f.responsables.split(',').map((r) => r.trim()).filter(Boolean).join(', ') : null,
          estado: ESTADOS_TERMINADOS.includes(f.estado) ? 'Terminado' : 'Pendiente',
          comentario: `${extra}${f.tarea && !CATEGORIAS[f.tarea] ? `(${f.tarea}) ` : ''}${f.comentario}`.trim() || null,
        };
      }),
    });
  }
  return obras.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const archivos = args.filter((a) => a !== '--dry-run');
  if (archivos.length === 0) {
    console.error('Uso: node importar_planificacion_notion.js <archivo.txt> [más archivos…] [--dry-run]');
    process.exit(1);
  }

  const filas = leerFilas(archivos);
  const obras = armarObras(filas);
  const tareas = obras.reduce((n, o) => n + o.tareas.length, 0);
  const terminadas = obras.filter((o) => o.estado === 'Terminada').length;
  console.log(`${filas.length} filas de Notion → ${obras.length} obras (${terminadas} marcadas Terminada), ${tareas} tareas`);

  if (dryRun) {
    for (const o of obras) {
      const montaje = o.tareas.filter((t) => t.categoria === 'Montaje').map((t) => `${t.fecha_inicio || '—'}${t.fecha_fin ? `→${t.fecha_fin}` : ''} ${t.responsable || ''}`).join(' | ');
      console.log(`- ${o.nombre} [${o.constructora || '—'}] ${o.estado} · ${o.tareas.length} tareas${montaje ? ` · Montaje: ${montaje}` : ''}`);
    }
    return;
  }

  if (!process.env.PANEL_API_URL || !process.env.SYNC_TOKEN) {
    throw new Error('Faltan PANEL_API_URL y/o SYNC_TOKEN en backend/drive_sync/.env');
  }
  const res = await fetch(`${process.env.PANEL_API_URL}/planificacion.php?token=${process.env.SYNC_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'importar_notion', obras }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  console.log(`Importado: ${data.obras_creadas} obras nuevas, ${data.tareas_creadas} tareas nuevas, ${data.tareas_salteadas} ya existían`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
