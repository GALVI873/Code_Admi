import { useEffect, useMemo, useState } from 'react'
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
  const [busquedaObra, setBusquedaObra] = useState('')
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

  const itemsFiltrados = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return itemsDeLaPestana
      .filter((it) => !texto || it.obra?.toLowerCase().includes(texto))
      .filter((it) => pestana !== 'Pedidos de Material' || filtroCategoria === 'Todas' || it.categoria === filtroCategoria)
  }, [itemsDeLaPestana, busquedaObra, filtroCategoria, pestana])

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
            <label htmlFor="filtro-obra">Obra</label>
            <input
              id="filtro-obra"
              type="text"
              className="input-filtro"
              placeholder="Filtrar por obra…"
              value={busquedaObra}
              onChange={(e) => setBusquedaObra(e.target.value)}
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
