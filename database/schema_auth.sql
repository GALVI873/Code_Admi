-- Esquema de autenticación y control de accesos (RBAC) — Panel Galvi
-- Cargar antes que cualquier tabla de negocio (presupuestos, etc.), ya que esas tablas
-- referenciarán usuarios.id como creador/responsable.

CREATE TABLE usuarios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE roles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE,
  descripcion VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE permisos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(100) NOT NULL UNIQUE,
  descripcion VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rol_permisos (
  rol_id INT UNSIGNED NOT NULL,
  permiso_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (rol_id, permiso_id),
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE usuario_roles (
  usuario_id INT UNSIGNED NOT NULL,
  rol_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, rol_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE refresh_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL, -- sha256 del token; el valor real solo vive en la cookie httpOnly del cliente
  expira_en DATETIME NOT NULL,
  revocado TINYINT(1) NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_token_hash (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE intentos_login (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  exitoso TINYINT(1) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_creado (email, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auditoria (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NULL,
  accion VARCHAR(100) NOT NULL,
  entidad VARCHAR(100) NULL,
  entidad_id INT UNSIGNED NULL,
  detalle JSON NULL,
  ip VARCHAR(45) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: roles y permisos iniciales para el piloto de Presupuestos.
-- Los permisos de futuros departamentos (gestion_obras.*, transporte.*, etc.) se agregan
-- cuando se construya cada módulo, sin tocar esta estructura.
INSERT INTO roles (nombre, descripcion) VALUES
  ('admin', 'Acceso total; aprueba y supervisa todos los departamentos'),
  ('presupuestos', 'Gestiona el ciclo de presupuestos');

INSERT INTO permisos (clave, descripcion) VALUES
  ('presupuestos.crear', 'Crear un nuevo presupuesto'),
  ('presupuestos.ver_propios', 'Ver los presupuestos que el usuario creó'),
  ('presupuestos.ver_todos', 'Ver todos los presupuestos de todos los usuarios'),
  ('presupuestos.editar', 'Editar intake, dibujo y solicitudes de precio de un presupuesto'),
  ('presupuestos.enviar', 'Enviar el presupuesto al cliente'),
  ('presupuestos.aprobar', 'Aprobar en la reunión gerencial (paso 6)'),
  ('presupuestos.reemplazar_version', 'Crear una nueva versión tras modificación post-aceptación'),
  ('usuarios.gestionar', 'Crear/editar usuarios, roles y permisos');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p WHERE r.nombre = 'admin';

INSERT INTO rol_permisos (rol_id, permiso_id)
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
