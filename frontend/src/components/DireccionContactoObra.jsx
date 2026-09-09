import { useEffect, useState } from 'react'

// Dirección y contacto (a pedido de Álvaro): dato 100% manual, no sale de
// ningún Excel — se guarda en cuanto se toca cada campo (onBlur), sin botón
// "Guardar" aparte, mismo criterio que el resto de los campos sueltos del
// panel (ej. Fecha límite de entrega en Presupuesto). La dirección, si hay
// algo cargado, se muestra además como link a Google Maps (con la
// localidad sumada a la búsqueda si también está cargada, para desambiguar
// calles con el mismo nombre en ciudades distintas).
//
// Compartido entre Obras Aceptadas (Ficha, por obra ya aceptada) y
// Presupuesto (modal de detalle, por nombre BASE de obra — ver
// SeguimientoPage.jsx) porque los datos viven en la MISMA tabla del
// backend (obra_direccion_contacto, keyeada por nombre base): la dirección
// se puede cargar apenas se presupuesta y sigue viéndose igual una vez
// aceptada la obra, sin tener que cargarla dos veces.
export default function DireccionContactoObra({ obra, datos, onGuardar }) {
  // El nombre de obra trae comas/espacios ("Manipa, 89") — no válidos en un
  // id de HTML, así que los inputs usan esta versión "limpia" solo para
  // id/htmlFor (la key de React sí puede llevar el nombre tal cual).
  const idBase = obra.replace(/[^a-zA-Z0-9]+/g, '-')
  const [campos, setCampos] = useState({
    direccion: '',
    localidad: '',
    contacto_nombre: '',
    telefono: '',
    email: '',
  })

  useEffect(() => {
    setCampos({
      direccion: datos?.direccion || '',
      localidad: datos?.localidad || '',
      contacto_nombre: datos?.contacto_nombre || '',
      telefono: datos?.telefono || '',
      email: datos?.email || '',
    })
  }, [obra, datos])

  function guardarCampo(campo, valorCrudo) {
    const valor = valorCrudo.trim()
    if (valor === (campos[campo] || '')) return // sin cambios, no manda un PATCH de más
    const actualizado = { ...campos, [campo]: valor }
    setCampos(actualizado)
    onGuardar(actualizado)
  }

  const direccionParaMapa = [campos.direccion, campos.localidad].filter(Boolean).join(', ')
  const urlMapa = direccionParaMapa
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionParaMapa)}`
    : null

  return (
    <div className="direccion-contacto">
      <h3>Dirección y contacto</h3>
      <div className="direccion-contacto-grid">
        <div className="filtro-campo direccion-contacto-campo-direccion">
          <label htmlFor={`direccion-${idBase}`}>Dirección</label>
          <input
            id={`direccion-${idBase}`}
            type="text"
            className="input-filtro"
            defaultValue={campos.direccion}
            key={`direccion-${obra}-${campos.direccion}`}
            placeholder="Calle, número…"
            onBlur={(e) => guardarCampo('direccion', e.target.value)}
          />
          {urlMapa && (
            <a href={urlMapa} target="_blank" rel="noopener noreferrer" className="direccion-mapa-link">
              📍 Ver en Google Maps
            </a>
          )}
        </div>
        <div className="filtro-campo">
          <label htmlFor={`localidad-${idBase}`}>Localidad</label>
          <input
            id={`localidad-${idBase}`}
            type="text"
            className="input-filtro"
            defaultValue={campos.localidad}
            key={`localidad-${obra}-${campos.localidad}`}
            onBlur={(e) => guardarCampo('localidad', e.target.value)}
          />
        </div>
        <div className="filtro-campo">
          <label htmlFor={`contacto-nombre-${idBase}`}>Persona de contacto</label>
          <input
            id={`contacto-nombre-${idBase}`}
            type="text"
            className="input-filtro"
            defaultValue={campos.contacto_nombre}
            key={`contacto-nombre-${obra}-${campos.contacto_nombre}`}
            onBlur={(e) => guardarCampo('contacto_nombre', e.target.value)}
          />
        </div>
        <div className="filtro-campo">
          <label htmlFor={`telefono-${idBase}`}>Teléfono</label>
          <input
            id={`telefono-${idBase}`}
            type="text"
            className="input-filtro"
            defaultValue={campos.telefono}
            key={`telefono-${obra}-${campos.telefono}`}
            onBlur={(e) => guardarCampo('telefono', e.target.value)}
          />
        </div>
        <div className="filtro-campo">
          <label htmlFor={`email-${idBase}`}>Email</label>
          <input
            id={`email-${idBase}`}
            type="email"
            className="input-filtro"
            defaultValue={campos.email}
            key={`email-${obra}-${campos.email}`}
            onBlur={(e) => guardarCampo('email', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
