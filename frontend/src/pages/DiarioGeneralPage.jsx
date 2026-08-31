import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { diarioGeneral, actualizarUbicacionDiarioGeneral } from '../api/client.js'

// Diario General de pedidos de material y gestión — compartida entre
// Alfredo y Álvaro según la entrevista de Fase 1. Los datos vienen de
// backend/drive_sync/sync_diario_general.js, que lee la hoja "Diario
// General" del Excel real y deja fuera a propósito lo administrativo/
// facturación (alcance acordado).
//
// Pedidos de Material se agrupa por Proveedor (no por obra): así se ve de
// un vistazo qué hay pendiente por cada proveedor. Los ítems con Ubicación
// "Obra" (material ya entregado en obra) se ocultan de esta tabla, ya no
// necesitan seguimiento acá. Ubicación es editable en el panel — ver aviso
// de límite conocido junto al PATCH en public/api/diario_general.php: un
// cambio hecho acá se pierde si la próxima sincronización completa del
// Excel no refleja lo mismo, porque no hay clave estable entre corridas.
const CATEGORIAS_MATERIAL = ['Proveedor', 'Chapas', 'Vidrios', 'Fabricar', 'Persianas', 'Lacador', 'Medir', 'Acopio']
const OPCIONES_UBICACION = ['', 'Borox', 'Obra', 'Servido', 'Oficina', 'Transportista', 'Proveedor']

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

function SelectUbicacion({ item, onCambio }) {
  return (
    <select
      className="select-inline"
      value={item.ubicacion || ''}
      onChange={(e) => onCambio(item.id, e.target.value)}
    >
      {OPCIONES_UBICACION.map((op) => (
        <option key={op || 'vacio'} value={op}>{op || '—'}</option>
      ))}
    </select>
  )
}

// Filtro de obra con selección múltiple: antes era un texto libre que solo
// dejaba ver una obra a la vez — Alfredo/Álvaro pidieron poder comparar
// varias obras juntas. Escribir sigue filtrando la lista de opciones, pero
// ahora cada obra se agrega como chip en vez de reemplazar la búsqueda.
function SelectorObrasMultiple({ obras, seleccionadas, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function alHacerClicFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alHacerClicFuera)
    return () => document.removeEventListener('mousedown', alHacerClicFuera)
  }, [])

  const obrasFiltradas = obras.filter((o) => o.toLowerCase().includes(texto.trim().toLowerCase()))

  function alternar(obra) {
    const nuevo = new Set(seleccionadas)
    if (nuevo.has(obra)) nuevo.delete(obra)
    else nuevo.add(obra)
    onCambiar(nuevo)
  }

  function quitar(obra, e) {
    e.stopPropagation()
    const nuevo = new Set(seleccionadas)
    nuevo.delete(obra)
    onCambiar(nuevo)
  }

  return (
    <div className="selector-obras" ref={ref}>
      <div className="selector-obras-campo" onClick={() => setAbierto(true)}>
        {[...seleccionadas].map((o) => (
          <span key={o} className="chip-obra">
            {o}
            <button type="button" onClick={(e) => quitar(o, e)} aria-label={`Quitar ${o}`}>✕</button>
          </span>
        ))}
        <input
          type="text"
          className="selector-obras-input"
          placeholder={seleccionadas.size === 0 ? 'Filtrar por obra…' : ''}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => setAbierto(true)}
        />
      </div>
      {abierto && (
        <div className="selector-obras-lista">
          {obrasFiltradas.length === 0 && <div className="selector-obras-vacio">Sin resultados</div>}
          {obrasFiltradas.map((o) => (
            <label key={o} className="selector-obras-opcion">
              <input type="checkbox" checked={seleccionadas.has(o)} onChange={() => alternar(o)} />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function agruparPorProveedor(items) {
  const grupos = new Map()
  for (const it of items) {
    const clave = it.proveedor || 'Sin proveedor'
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(it)
  }
  return [...grupos.entries()].sort(([a], [b]) => {
    if (a === 'Sin proveedor') return 1
    if (b === 'Sin proveedor') return -1
    return a.localeCompare(b)
  })
}

function TablaPedidosMaterial({ items, onCambiarUbicacion }) {
  const grupos = useMemo(() => agruparPorProveedor(items), [items])

  if (items.length === 0) {
    return <p className="dashboard-nota">Ningún ítem coincide con los filtros aplicados.</p>
  }

  return (
    <>
      {grupos.map(([proveedor, filas]) => (
        <section key={proveedor} className="obras-seccion">
          <h2 className="obras-seccion-titulo">
            {proveedor} <span className="obras-seccion-contador">{filas.length}</span>
          </h2>
          <div className="tabla-scroll">
            <table className="tabla-ofertas">
              <thead>
                <tr>
                  <th>Obra</th>
                  <th>Categoría</th>
                  <th>Descripción</th>
                  <th>Fecha Pedido</th>
                  <th>Fecha Entrega</th>
                  <th>Ubicación</th>
                  <th>Tarea entrega a obra</th>
                  <th>Estatus</th>
                  <th>Comentario</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((it) => (
                  <tr key={it.id}>
                    <td className="seguimiento-oferta-proveedor">{it.obra}</td>
                    <td>{it.categoria}</td>
                    <td>{it.descripcion || '—'}</td>
                    <td>{formatoFecha(it.fecha_pedido) || '—'}</td>
                    <td>{formatoFecha(it.fecha_entrega_proveedor) || '—'}</td>
                    <td><SelectUbicacion item={it} onCambio={onCambiarUbicacion} /></td>
                    <td>{it.tarea_3 || '—'}</td>
                    <td>{it.estatus_2 || '—'}</td>
                    <td>{it.comentario || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}

function TablaGestion({ items }) {
  if (items.length === 0) {
    return <p className="dashboard-nota">Ninguna tarea coincide con los filtros aplicados.</p>
  }
  return (
    <div className="tabla-scroll">
      <table className="tabla-ofertas">
        <thead>
          <tr>
            <th>Obra</th>
            <th>Descripción</th>
            <th>Objetivo inicio</th>
            <th>Objetivo fin</th>
            <th>Tarea</th>
            <th>Comentario</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="seguimiento-oferta-proveedor">{it.obra}</td>
              <td>{it.descripcion || '—'}</td>
              <td>{formatoFecha(it.fecha_objetivo_inicio) || '—'}</td>
              <td>{formatoFecha(it.fecha_objetivo_fin) || '—'}</td>
              <td>{it.tarea_1 || '—'}</td>
              <td>{it.comentario || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PESTANAS = ['Pedidos de Material', 'Gestión']

export default function DiarioGeneralPage() {
  const { accessToken } = useAuth()
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [pestana, setPestana] = useState('Pedidos de Material')
  const [obrasSeleccionadas, setObrasSeleccionadas] = useState(() => new Set())
  const [filtroCategoria, setFiltroCategoria] = useState('Todas')

  useEffect(() => {
    diarioGeneral(accessToken)
      .then((data) => setItems(data.items || []))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const itemsDeLaPestana = useMemo(() => {
    if (pestana === 'Gestión') return items.filter((it) => it.categoria === 'Gestión')
    return items.filter((it) => CATEGORIAS_MATERIAL.includes(it.categoria) && it.ubicacion !== 'Obra')
  }, [items, pestana])

  const obrasDisponibles = useMemo(() => {
    return [...new Set(itemsDeLaPestana.map((it) => it.obra).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }, [itemsDeLaPestana])

  const itemsFiltrados = useMemo(() => {
    return itemsDeLaPestana
      .filter((it) => obrasSeleccionadas.size === 0 || obrasSeleccionadas.has(it.obra))
      .filter((it) => pestana !== 'Pedidos de Material' || filtroCategoria === 'Todas' || it.categoria === filtroCategoria)
  }, [itemsDeLaPestana, obrasSeleccionadas, filtroCategoria, pestana])

  function handleCambioPestana(p) {
    setPestana(p)
    setFiltroCategoria('Todas')
  }

  async function handleCambiarUbicacion(id, ubicacion) {
    const anteriores = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ubicacion } : it)))
    try {
      await actualizarUbicacionDiarioGeneral(accessToken, id, ubicacion)
    } catch (err) {
      setItems(anteriores)
      setError(err.message)
    }
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Diario General</h1>
          <p>Pedidos de material y tareas de gestión por obra — sincronizado desde el Excel de Alfredo</p>
        </div>
      </header>

      <div className="seguimiento-pestanas">
        {PESTANAS.map((p) => (
          <button
            key={p}
            type="button"
            className={`seguimiento-pestana ${p === pestana ? 'seguimiento-pestana-activa' : ''}`}
            onClick={() => handleCambioPestana(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {!cargando && !error && (
        <div className="filtro-tabla">
          <div className="filtro-campo">
            <label>Obra</label>
            <SelectorObrasMultiple
              obras={obrasDisponibles}
              seleccionadas={obrasSeleccionadas}
              onCambiar={setObrasSeleccionadas}
            />
          </div>
          {pestana === 'Pedidos de Material' && (
            <div className="filtro-campo">
              <label htmlFor="filtro-categoria">Categoría</label>
              <select
                id="filtro-categoria"
                className="select-inline"
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
              >
                <option value="Todas">Todas</option>
                {CATEGORIAS_MATERIAL.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </div>
          )}
          <span className="filtro-contador">
            {itemsFiltrados.length} de {itemsDeLaPestana.length}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {!cargando && !error && (
        pestana === 'Pedidos de Material'
          ? <TablaPedidosMaterial items={itemsFiltrados} onCambiarUbicacion={handleCambiarUbicacion} />
          : <TablaGestion items={itemsFiltrados} />
      )}
    </div>
  )
}
