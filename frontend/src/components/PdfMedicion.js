// Informe de medición en PDF (a pedido de Álvaro, 2026-10-02), con la
// imagen corporativa de PdfMarca.js. A4 apaisado:
//   1. Portada: obra, cliente, fecha, quién midió y resumen.
//   2. Cada página del plano (con su nombre) con las marcas de posición
//      (verde = medida, naranja = falta) y las notas (N1, N2...).
//   3. Tabla de medidas: posición, tipo, medida de PROYECTO (Ancho/Alto
//      Proy. del MEDYSEG), medida REAL y la diferencia — resaltada si es de
//      10 mm o más.
//   4. Ficha de cada posición con algo que contar: dibujo, medidas,
//      comentario y fotos.
//   5. Notas de obra con su texto y fotos.
import { TEAL, TEAL_SUAVE, TEAL_OSCURO, GRIS, TEXTO, EMPRESA, PROPORCION_LOGO, prepararMarca, pieCorporativo } from './PdfMarca.js'

const MARGEN = 12
const UMBRAL_DIFERENCIA = 10 // mm

function hoyLargo() {
  const h = new Date()
  return `${String(h.getDate()).padStart(2, '0')}/${String(h.getMonth() + 1).padStart(2, '0')}/${h.getFullYear()}`
}

function formatoImagen(dataUrl) {
  return /^data:image\/png/i.test(dataUrl || '') ? 'PNG' : 'JPEG'
}

function mm(valor) {
  const n = Number(valor)
  return n > 0 ? String(Math.round(n)) : '—'
}

function diferencia(real, proyecto) {
  const r = Number(real)
  const p = Number(proyecto)
  return r > 0 && p > 0 ? Math.round(r - p) : null
}

function textoDif(d) {
  return d === null ? '—' : `${d > 0 ? '+' : ''}${d}`
}

// Encabezado pequeño de las páginas interiores.
function encabezado(doc, logo, titulo, obra) {
  const ancho = doc.internal.pageSize.getWidth()
  doc.addImage(logo, 'PNG', MARGEN, 6, 11 * PROPORCION_LOGO, 11)
  doc.setFont('Carlito', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GRIS)
  doc.text(titulo, ancho - MARGEN, 11, { align: 'right' })
  doc.setFont('Carlito', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...TEAL)
  doc.text(obra, ancho - MARGEN, 16, { align: 'right' })
  doc.setDrawColor(...TEAL)
  doc.setLineWidth(0.6)
  doc.line(MARGEN, 20, ancho - MARGEN, 20)
  return 26
}

// Coloca una imagen dentro de una caja respetando su proporción; devuelve
// la caja ocupada { x, y, w, h }.
function imagenEnCaja(doc, dataUrl, x, y, maxW, maxH) {
  const prop = doc.getImageProperties(dataUrl)
  const escala = Math.min(maxW / prop.width, maxH / prop.height)
  const w = prop.width * escala
  const h = prop.height * escala
  const cx = x + (maxW - w) / 2
  doc.addImage(dataUrl, formatoImagen(dataUrl), cx, y, w, h)
  return { x: cx, y, w, h }
}

// Grilla de fotos desde "y"; salta de página cuando no entran. Devuelve la
// nueva "y".
function grillaFotos(doc, fotos, y, nuevaPagina) {
  if (fotos.length === 0) return y
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const columnas = 4
  const sep = 4
  const w = (ancho - MARGEN * 2 - sep * (columnas - 1)) / columnas
  const h = w * 0.75
  let x = MARGEN
  let col = 0
  for (const f of fotos) {
    if (y + h > alto - 16) {
      y = nuevaPagina()
      x = MARGEN
      col = 0
    }
    const src = f.archivo_base64 || f.miniatura_base64
    if (src) {
      doc.setDrawColor(225, 230, 236)
      doc.setLineWidth(0.2)
      doc.rect(x, y, w, h)
      imagenEnCaja(doc, src, x + 0.5, y + 0.5, w - 1, h - 1)
    }
    col++
    if (col === columnas) {
      col = 0
      x = MARGEN
      y += h + sep
    } else {
      x += w + sep
    }
  }
  return col === 0 ? y : y + h + sep
}

export async function descargarPdfMedicion(d) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const logo = await prepararMarca(doc)
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const titulo = 'INFORME DE MEDICIÓN'

  const medidas = d.posicionesBase.filter((p) => {
    const m = d.medidas.get(p)
    return m && Number(m.ancho_real) > 0 && Number(m.alto_real) > 0
  }).length
  const fotosDe = (refTipo, ref) => d.fotos.filter((f) => f.ref_tipo === refTipo && String(f.ref) === String(ref))
  const quienes = [...new Set([...d.medidas.values()].map((m) => m.confirmado_por).filter(Boolean))]

  // ---------- 1. Portada ----------
  doc.addImage(logo, 'PNG', MARGEN, 14, 40 * PROPORCION_LOGO, 40)
  doc.setFont('Carlito', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...GRIS)
  doc.text(titulo, ancho - MARGEN, 34, { align: 'right' })
  doc.setDrawColor(...TEAL)
  doc.setLineWidth(1)
  doc.line(MARGEN, 62, ancho - MARGEN, 62)
  const filasPortada = [
    ['Obra', d.obra],
    ['Cliente', d.cliente || '—'],
    ['Fecha del informe', hoyLargo()],
    ['Medido por', quienes.join(', ') || '—'],
    ['Posiciones medidas', `${medidas} de ${d.posicionesBase.length}`],
    ['Notas de obra', String(d.notas.length)],
    ['Fotos', String(d.fotos.length)],
  ]
  autoTable(doc, {
    startY: 74,
    margin: { left: MARGEN + 30, right: MARGEN + 30 },
    body: filasPortada,
    theme: 'plain',
    styles: { font: 'Carlito', fontSize: 13, cellPadding: 3, textColor: TEXTO },
    columnStyles: { 0: { fontStyle: 'bold', textColor: TEAL_OSCURO, cellWidth: 70 } },
  })
  doc.setFont('Carlito', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...GRIS)
  doc.text(EMPRESA, MARGEN, alto - 18)

  // ---------- 2. Planos ----------
  for (const pag of d.paginas) {
    doc.addPage()
    const nombre = d.nombresPaginas.get(pag.pagina) || `Página ${pag.pagina}`
    let y = encabezado(doc, logo, titulo, d.obra)
    doc.setFont('Carlito', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...TEAL_OSCURO)
    doc.text(`Plano — ${nombre}`, MARGEN, y)
    y += 4
    const caja = imagenEnCaja(doc, pag.imagen_base64, MARGEN, y, ancho - MARGEN * 2, alto - y - 22)
    // Marcas de posición
    for (const p of d.posiciones.filter((x) => x.pagina === pag.pagina)) {
      const m = d.medidas.get(p.posicion_base)
      const ok = m && Number(m.ancho_real) > 0 && Number(m.alto_real) > 0
      const cx = caja.x + (p.x_pct / 100) * caja.w
      const cy = caja.y + (p.y_pct / 100) * caja.h
      doc.setFillColor(...(ok ? [46, 160, 90] : [230, 126, 34]))
      doc.setDrawColor(255, 255, 255)
      doc.setLineWidth(0.4)
      doc.circle(cx, cy, 2.2, 'FD')
      doc.setFont('Carlito', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(30, 30, 30)
      doc.text(String(p.posicion_base), cx + 2.8, cy + 1)
    }
    // Notas
    for (const n of d.notas.filter((x) => x.pagina === pag.pagina)) {
      const cx = caja.x + (n.x_pct / 100) * caja.w
      const cy = caja.y + (n.y_pct / 100) * caja.h
      doc.setFillColor(...TEAL_OSCURO)
      doc.roundedRect(cx - 3.5, cy - 2.4, 7, 4.8, 1, 1, 'F')
      doc.setFont('Carlito', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(255, 255, 255)
      doc.text(`N${n.numero}`, cx, cy + 1, { align: 'center' })
    }
    doc.setFont('Carlito', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text('● verde: medida confirmada   ● naranja: falta medir   N#: nota de obra', MARGEN, alto - 14)
  }

  // ---------- 3. Tabla de medidas ----------
  doc.addPage()
  let y = encabezado(doc, logo, titulo, d.obra)
  doc.setFont('Carlito', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...TEAL_OSCURO)
  doc.text('Medidas: proyecto frente a obra (mm)', MARGEN, y)
  const paginaTabla = doc.internal.getCurrentPageInfo().pageNumber
  const filas = d.posicionesBase.map((p) => {
    const m = d.medidas.get(p) || {}
    const pr = d.proyecto.get(p) || {}
    const dA = diferencia(m.ancho_real, pr.ancho)
    const dH = diferencia(m.alto_real, pr.alto)
    return { celdas: [p, d.tipoPorPosicion.get(p) || '', mm(pr.ancho), mm(pr.alto), mm(m.ancho_real), mm(m.alto_real), textoDif(dA), textoDif(dH), m.comentario || ''], dA, dH }
  })
  autoTable(doc, {
    startY: y + 3,
    margin: { left: MARGEN, right: MARGEN, bottom: 16, top: 26 },
    head: [['Pos.', 'Tipo', 'Ancho proy.', 'Alto proy.', 'Ancho real', 'Alto real', 'Dif. ancho', 'Dif. alto', 'Comentario']],
    body: filas.map((f) => f.celdas),
    theme: 'grid',
    styles: { font: 'Carlito', fontSize: 9, cellPadding: 1.6, textColor: TEXTO, lineColor: [222, 228, 232], lineWidth: 0.1, valign: 'middle' },
    headStyles: { font: 'Carlito', fillColor: TEAL, textColor: 255, fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 22, halign: 'right' }, 3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' }, 5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' }, 7: { cellWidth: 20, halign: 'right' },
    },
    didParseCell: (h) => {
      if (h.section !== 'body') return
      const f = filas[h.row.index]
      const sinMedir = h.column.index === 4 || h.column.index === 5 ? h.cell.raw === '—' : false
      if (sinMedir) h.cell.styles.textColor = [230, 126, 34]
      const dif = h.column.index === 6 ? f.dA : h.column.index === 7 ? f.dH : null
      if (dif !== null && Math.abs(dif) >= UMBRAL_DIFERENCIA) {
        h.cell.styles.fillColor = [253, 226, 225]
        h.cell.styles.textColor = [163, 58, 55]
        h.cell.styles.fontStyle = 'bold'
      }
    },
    // Cabecera en las páginas siguientes de la tabla (la primera ya la tiene).
    didDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > paginaTabla) encabezado(doc, logo, titulo, d.obra) },
  })
  doc.setFont('Carlito', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRIS)
  doc.text(`Diferencia = real − proyecto. Resaltadas las de ${UMBRAL_DIFERENCIA} mm o más. "—": sin dato.`, MARGEN, doc.lastAutoTable.finalY + 5)

  // ---------- 4. Fichas por posición ----------
  const nuevaPaginaFichas = () => {
    doc.addPage()
    return encabezado(doc, logo, titulo, d.obra)
  }
  const conFicha = d.posicionesBase.filter((p) => {
    const m = d.medidas.get(p)
    return (m && (Number(m.ancho_real) > 0 || m.comentario)) || fotosDe('posicion', p).length > 0 || d.dibujoDe(p)
  })
  if (conFicha.length > 0) {
    y = nuevaPaginaFichas()
    doc.setFont('Carlito', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...TEAL_OSCURO)
    doc.text('Fichas por posición', MARGEN, y)
    y += 6
    for (const p of conFicha) {
      const m = d.medidas.get(p) || {}
      const pr = d.proyecto.get(p) || {}
      const dibujo = d.dibujoDe(p)
      const altoBloque = 62
      if (y + altoBloque > alto - 16) y = nuevaPaginaFichas()
      doc.setFillColor(...TEAL_SUAVE)
      doc.rect(MARGEN, y, ancho - MARGEN * 2, 7, 'F')
      doc.setFont('Carlito', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...TEAL_OSCURO)
      doc.text(`Posición ${p}${d.tipoPorPosicion.get(p) ? ` — ${d.tipoPorPosicion.get(p)}` : ''}`, MARGEN + 2, y + 5)
      y += 10
      let xDatos = MARGEN
      if (dibujo) {
        imagenEnCaja(doc, dibujo, MARGEN, y, 60, 48)
        xDatos = MARGEN + 66
      }
      autoTable(doc, {
        startY: y,
        margin: { left: xDatos, right: MARGEN },
        tableWidth: 110,
        head: [['', 'Proyecto', 'Real', 'Diferencia']],
        body: [
          ['Ancho (mm)', mm(pr.ancho), mm(m.ancho_real), textoDif(diferencia(m.ancho_real, pr.ancho))],
          ['Alto (mm)', mm(pr.alto), mm(m.alto_real), textoDif(diferencia(m.alto_real, pr.alto))],
        ],
        theme: 'grid',
        styles: { font: 'Carlito', fontSize: 9.5, cellPadding: 1.5, textColor: TEXTO, lineColor: [222, 228, 232], lineWidth: 0.1 },
        headStyles: { font: 'Carlito', fillColor: [245, 247, 248], textColor: TEAL_OSCURO, fontStyle: 'bold' },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
      let yTexto = doc.lastAutoTable.finalY + 5
      if (m.comentario) {
        doc.setFont('Carlito', 'normal')
        doc.setFontSize(9.5)
        doc.setTextColor(...TEXTO)
        const lineas = doc.splitTextToSize(`Comentario: ${m.comentario}`, ancho - xDatos - MARGEN)
        doc.text(lineas, xDatos, yTexto)
        yTexto += lineas.length * 4.5
      }
      y = Math.max(y + (dibujo ? 52 : 0), yTexto) + 2
      y = grillaFotos(doc, fotosDe('posicion', p), y, nuevaPaginaFichas)
      y += 4
    }
  }

  // ---------- 5. Notas de obra ----------
  if (d.notas.length > 0) {
    y = nuevaPaginaFichas()
    doc.setFont('Carlito', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...TEAL_OSCURO)
    doc.text('Notas de obra', MARGEN, y)
    y += 6
    for (const n of d.notas) {
      if (y + 20 > alto - 16) y = nuevaPaginaFichas()
      doc.setFillColor(...TEAL_SUAVE)
      doc.rect(MARGEN, y, ancho - MARGEN * 2, 7, 'F')
      doc.setFont('Carlito', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...TEAL_OSCURO)
      doc.text(`N${n.numero} — ${d.nombresPaginas.get(n.pagina) || `Página ${n.pagina}`}`, MARGEN + 2, y + 5)
      y += 11
      doc.setFont('Carlito', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...TEXTO)
      const lineas = doc.splitTextToSize(n.texto || 'Sin texto', ancho - MARGEN * 2)
      doc.text(lineas, MARGEN, y)
      y += lineas.length * 4.8 + 2
      y = grillaFotos(doc, fotosDe('nota', n.id), y, nuevaPaginaFichas)
      y += 4
    }
  }

  pieCorporativo(doc, MARGEN)
  const nombreArchivo = d.obra.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_')
  doc.save(`Informe_medicion_${nombreArchivo}_${hoyLargo().split('/').reverse().join('-')}.pdf`)
}
