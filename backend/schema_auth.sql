-- Esquema de autenticación y control de accesos (RBAC) — Panel Galvi
-- SQLite (no MySQL): elegido porque el hosting solo da acceso por FTP,
-- sin panel de administración ni SSH para crear una base de datos MySQL
-- por separado. Este archivo se ejecuta completo vía public/api/setup.php.
--
-- Vive dentro de backend/ (no en una carpeta database/ aparte) a propósito:
-- backend/ es la única carpeta que el workflow de deploy sube siempre, así
-- este archivo nunca puede faltar en el servidor por un paso de deploy olvidado.

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS usuarios_actualizado_en
AFTER UPDATE ON usuarios
FOR EACH ROW
BEGIN
  UPDATE usuarios SET actualizado_en = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS permisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS rol_permisos (
  rol_id INTEGER NOT NULL,
  permiso_id INTEGER NOT NULL,
  PRIMARY KEY (rol_id, permiso_id),
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usuario_roles (
  usuario_id INTEGER NOT NULL,
  rol_id INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, rol_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL, -- sha256 del token; el valor real solo vive en la cookie httpOnly del cliente
  expira_en TEXT NOT NULL,
  revocado INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS intentos_login (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  exitoso INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intentos_login_email_creado ON intentos_login(email, creado_en);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NULL,
  accion TEXT NOT NULL,
  entidad TEXT NULL,
  entidad_id INTEGER NULL,
  detalle TEXT NULL,
  ip TEXT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Seed: roles y permisos iniciales para el piloto de Presupuestos.
-- Los permisos de futuros departamentos (gestion_obras.*, transporte.*, etc.) se agregan
-- cuando se construya cada módulo, sin tocar esta estructura.
INSERT OR IGNORE INTO roles (nombre, descripcion) VALUES
  ('admin', 'Acceso total; aprueba y supervisa todos los departamentos'),
  ('presupuestos', 'Gestiona el ciclo de presupuestos'),
  ('gestion_obras', 'Gestión de Obras — sin permisos propios todavía, se agregan cuando se construya ese módulo');

INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES
  ('presupuestos.crear', 'Crear un nuevo presupuesto'),
  ('presupuestos.ver_propios', 'Ver los presupuestos que el usuario creó'),
  ('presupuestos.ver_todos', 'Ver todos los presupuestos de todos los usuarios'),
  ('presupuestos.editar', 'Editar intake, dibujo y solicitudes de precio de un presupuesto'),
  ('presupuestos.enviar', 'Enviar el presupuesto al cliente'),
  ('presupuestos.aprobar', 'Aprobar en la reunión gerencial (paso 6)'),
  ('presupuestos.reemplazar_version', 'Crear una nueva versión tras modificación post-aceptación'),
  ('presupuestos.gestionar_prioridad', 'Cambiar la prioridad de un presupuesto en estudio'),
  ('usuarios.gestionar', 'Crear/editar usuarios, roles y permisos');

INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p WHERE r.nombre = 'admin';

INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.nombre = 'presupuestos'
  AND p.clave IN (
    'presupuestos.crear',
    'presupuestos.ver_propios',
    'presupuestos.editar',
    'presupuestos.enviar',
    'presupuestos.reemplazar_version'
  );

-- Nota: 'presupuestos.aprobar' y 'presupuestos.ver_todos' quedan solo en 'admin' a propósito
-- (paso 6 del flujo es aprobación gerencial exclusiva de Álvaro).
