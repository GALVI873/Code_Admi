<?php
declare(strict_types=1);

// GET: lista los presupuestos en estudio (requiere sesión + permiso presupuestos.ver_todos).
// POST: upsert de un registro, usado por el proceso de sincronización con Drive
// (protegido por SYNC_TOKEN, no por sesión de usuario — es máquina a máquina).
// PATCH: cambia la prioridad (Alta/Normal) — requiere sesión + permiso
// presupuestos.gestionar_prioridad (solo admin).

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    // La tabla se auto-inicializa acá (SQL inline, no un archivo aparte) para no
    // repetir el bug de "el schema no se desplegó" que ya pasó una vez con
    // backend/schema_auth.sql.
    $db->exec("
        CREATE TABLE IF NOT EXISTS presupuestos_en_estudio (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL UNIQUE,
          cliente TEXT,
          estatus TEXT NOT NULL DEFAULT 'En Estudio',
          no_ventanas INTEGER,
          precio_m2 REAL,
          ral TEXT,
          persiana TEXT,
          vidrio TEXT,
          precio_ultimo_presupuesto REAL,
          porcentaje_ganancia REAL,
          prioridad TEXT NOT NULL DEFAULT 'Normal',
          fecha_ultimo_envio TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Migraciones idempotentes: si la tabla ya existía de antes sin estas
    // columnas (producción), se agregan sin tocar los datos existentes.
    $columnas = array_column($db->query('PRAGMA table_info(presupuestos_en_estudio)')->fetchAll(), 'name');
    if (!in_array('prioridad', $columnas, true)) {
        $db->exec("ALTER TABLE presupuestos_en_estudio ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'Normal'");
    }
    if (!in_array('fecha_ultimo_envio', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN fecha_ultimo_envio TEXT');
    }

    // Igual de idempotente para el permiso nuevo: se crea y se asigna solo a
    // admin si todavía no existe (no rompe nada si ya corrió antes).
    $db->exec("INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES ('presupuestos.gestionar_prioridad', 'Cambiar la prioridad de un presupuesto en estudio')");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'admin' AND p.clave = 'presupuestos.gestionar_prioridad'
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_todos');

        $stmt = $db->query('SELECT * FROM presupuestos_en_estudio ORDER BY actualizado_en DESC');
        Response::json(['presupuestos' => $stmt->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'presupuestos.gestionar_prioridad');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        $prioridad = trim((string) ($body['prioridad'] ?? ''));

        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        if (!in_array($prioridad, ['Alta', 'Normal'], true)) {
            Response::error('"prioridad" debe ser "Alta" o "Normal"', 422);
        }

        $db->prepare("UPDATE presupuestos_en_estudio SET prioridad = ?, actualizado_en = datetime('now') WHERE id = ?")
            ->execute([$prioridad, $id]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;
        $obra = trim((string) ($body['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        // "prioridad" no se toca acá a propósito: es un dato que decide un
        // admin desde el panel, la sincronización con Drive nunca la pisa.
        $stmt = $db->prepare("
            INSERT INTO presupuestos_en_estudio
                (obra, cliente, estatus, no_ventanas, precio_m2, ral, persiana, vidrio, precio_ultimo_presupuesto, porcentaje_ganancia, fecha_ultimo_envio, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra) DO UPDATE SET
                cliente = excluded.cliente,
                estatus = excluded.estatus,
                no_ventanas = excluded.no_ventanas,
                precio_m2 = excluded.precio_m2,
                ral = excluded.ral,
                persiana = excluded.persiana,
                vidrio = excluded.vidrio,
                precio_ultimo_presupuesto = excluded.precio_ultimo_presupuesto,
                porcentaje_ganancia = excluded.porcentaje_ganancia,
                fecha_ultimo_envio = excluded.fecha_ultimo_envio,
                actualizado_en = datetime('now')
        ");
        $stmt->execute([
            $obra,
            $body['cliente'] ?? null,
            $body['estatus'] ?? 'En Estudio',
            $body['no_ventanas'] ?? null,
            $body['precio_m2'] ?? null,
            $body['ral'] ?? null,
            $body['persiana'] ?? null,
            $body['vidrio'] ?? null,
            $body['precio_ultimo_presupuesto'] ?? null,
            $body['porcentaje_ganancia'] ?? null,
            $body['fecha_ultimo_envio'] ?? null,
        ]);

        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
