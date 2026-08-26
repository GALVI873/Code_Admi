<?php
declare(strict_types=1);

// GET: lista los presupuestos en estudio (requiere sesión + permiso presupuestos.ver_todos).
// POST: upsert de un registro, usado por el proceso de sincronización con Drive
// (protegido por SYNC_TOKEN, no por sesión de usuario — es máquina a máquina).
// Con {accion:"listar"} devuelve obra/estatus/fecha_ultimo_envio de todas las
// filas (lectura administrativa, sin sesión). Con {accion:"marcar_estatus",
// obras:[...], estatus:"..."} hace limpieza en bloque (pisa el estatus sin
// importar cuál tenía, a diferencia del upsert).
// PATCH: cambia prioridad y/o estatus:
//   - "prioridad" requiere el permiso presupuestos.gestionar_prioridad (solo admin).
//   - "estatus" requiere presupuestos.ver_todos (cualquiera que pueda ver la tabla).
// DELETE: protegido por SYNC_TOKEN igual que POST. Con {obras:[...]} borra esas
// filas puntuales sin importar su estatus; con {obras_activas:[...]} reconcilia
// tras un sync (borra lo que no está en la lista, solo en estatus por defecto).

$config = require __DIR__ . '/../../backend/bootstrap.php';

// "En Estudio" es el default automático (recién descubierta en Drive, sin
// envío todavía). "En Valoración"/"En Revisión" son afinamientos manuales de
// esa misma fase — nadie los pone la sincronización, solo una persona. "Pdt
// Aprobación" es automático en cuanto la sincronización encuentra un PDF en
// la carpeta Enviados de la obra (para cualquiera de los tres estatus de
// arriba). Descartado/Aceptado son decisiones finales manuales.
const ESTATUS_VALIDOS = ['En Estudio', 'En Valoración', 'En Revisión', 'Pdt Aprobación', 'Aceptado', 'Descartado'];
const ESTATUS_PRE_ENVIO = ['En Estudio', 'En Valoración', 'En Revisión'];

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
    if (!in_array('categoria', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN categoria TEXT');
    }
    if (!in_array('contacto', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN contacto TEXT');
    }

    // Renombre de estatus: "Seguimiento" pasó a llamarse "Pdt Aprobación"
    // (mismo significado, nombre más preciso). No afecta filas nuevas, solo
    // limpia las que quedaron con el nombre viejo.
    $db->exec("UPDATE presupuestos_en_estudio SET estatus = 'Pdt Aprobación' WHERE estatus = 'Seguimiento'");

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

        // Más reciente a más antiguo por fecha de envío; las obras sin envío
        // (fecha_ultimo_envio NULL) quedan al final (SQLite ordena NULL como
        // el valor más chico, así que en DESC caen últimas).
        $stmt = $db->query('SELECT * FROM presupuestos_en_estudio ORDER BY fecha_ultimo_envio DESC');
        Response::json(['presupuestos' => $stmt->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }

        if (array_key_exists('prioridad', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.gestionar_prioridad');
            $prioridad = trim((string) $body['prioridad']);
            if (!in_array($prioridad, ['Alta', 'Normal'], true)) {
                Response::error('"prioridad" debe ser "Alta" o "Normal"', 422);
            }
            $db->prepare("UPDATE presupuestos_en_estudio SET prioridad = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$prioridad, $id]);
        }

        if (array_key_exists('estatus', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_todos');
            $estatus = trim((string) $body['estatus']);
            if (!in_array($estatus, ESTATUS_VALIDOS, true)) {
                Response::error('"estatus" debe ser una de: ' . implode(', ', ESTATUS_VALIDOS), 422);
            }
            $db->prepare("UPDATE presupuestos_en_estudio SET estatus = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$estatus, $id]);
        }

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        // Modo administrativo de solo lectura: permite a las herramientas de
        // mantenimiento (que no tienen sesión de usuario) consultar el
        // estado actual del panel antes de decidir qué actualizar.
        if (($body['accion'] ?? '') === 'listar') {
            $stmt = $db->query('SELECT * FROM presupuestos_en_estudio');
            Response::json(['presupuestos' => $stmt->fetchAll()]);
        }

        // Modo administrativo (limpieza en bloque, ej. descartar obras
        // viejas desde una lista) — a diferencia del upsert de abajo, este
        // SÍ pisa el estatus sin importar cuál tenía antes: es una decisión
        // explícita, no la sincronización automática con Drive.
        if (($body['accion'] ?? '') === 'marcar_estatus') {
            $obras = $body['obras'] ?? null;
            $estatus = trim((string) ($body['estatus'] ?? ''));
            if (!is_array($obras) || count($obras) === 0) {
                Response::error('Falta "obras" (array no vacío)', 422);
            }
            if (!in_array($estatus, ESTATUS_VALIDOS, true)) {
                Response::error('"estatus" debe ser una de: ' . implode(', ', ESTATUS_VALIDOS), 422);
            }
            $marcadores = implode(',', array_fill(0, count($obras), '?'));
            $stmt = $db->prepare("
                UPDATE presupuestos_en_estudio SET estatus = ?, actualizado_en = datetime('now')
                WHERE obra IN ($marcadores)
            ");
            $stmt->execute([$estatus, ...$obras]);
            Response::json(['ok' => true, 'actualizados' => $stmt->rowCount()]);
        }

        $obra = trim((string) ($body['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        // "prioridad" no se toca acá a propósito en el UPDATE: es un dato que
        // decide un usuario desde el panel, la sincronización con Drive nunca
        // lo pisa. "estatus" es la única excepción: si la sincronización
        // encuentra un envío nuevo (excluded.estatus = 'Pdt Aprobación') y la
        // obra seguía en una de las fases previas al envío (En Estudio, En
        // Valoración o En Revisión), se pasa a 'Pdt Aprobación'
        // automáticamente. Cualquier otro estatus puesto a mano (Descartado,
        // Aceptado, o un Pdt Aprobación ya existente) nunca se pisa. En el
        // INSERT sí se usa el valor por defecto para una obra nueva.
        $estatusPreEnvio = "'" . implode("','", ESTATUS_PRE_ENVIO) . "'";
        $stmt = $db->prepare("
            INSERT INTO presupuestos_en_estudio
                (obra, cliente, estatus, no_ventanas, precio_m2, ral, persiana, vidrio, precio_ultimo_presupuesto, porcentaje_ganancia, fecha_ultimo_envio, categoria, contacto, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra) DO UPDATE SET
                cliente = excluded.cliente,
                estatus = CASE
                    WHEN presupuestos_en_estudio.estatus IN ($estatusPreEnvio) AND excluded.estatus = 'Pdt Aprobación'
                        THEN 'Pdt Aprobación'
                    ELSE presupuestos_en_estudio.estatus
                END,
                no_ventanas = excluded.no_ventanas,
                precio_m2 = excluded.precio_m2,
                ral = excluded.ral,
                persiana = excluded.persiana,
                vidrio = excluded.vidrio,
                precio_ultimo_presupuesto = excluded.precio_ultimo_presupuesto,
                porcentaje_ganancia = excluded.porcentaje_ganancia,
                fecha_ultimo_envio = excluded.fecha_ultimo_envio,
                categoria = excluded.categoria,
                contacto = excluded.contacto,
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
            $body['categoria'] ?? null,
            $body['contacto'] ?? null,
        ]);

        Response::json(['ok' => true]);
    }

    // DELETE: reconciliación tras la sincronización con Drive. Recibe la
    // lista completa de obras encontradas en este recorrido y borra las que
    // ya no aparecen (renombradas, movidas o archivadas) — pero solo si
    // siguen en un estatus previo a la decisión final (En Estudio, En
    // Valoración, En Revisión o Pdt Aprobación). Descartado y Aceptado son
    // decisiones ya tomadas y se conservan siempre como historial, aunque su
    // obra ya no exista en Drive con ese nombre.
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $token = $_GET['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];

        // Borrado puntual administrativo: lista explícita de obras a
        // eliminar del panel sin importar su estatus (ej. obras que se
        // aceptaron y se movieron a seguimiento de obra, ya no pertenecen
        // acá). Distinto del modo de reconciliación de abajo, que solo
        // borra las que están en estatus por defecto.
        if (isset($body['obras']) && is_array($body['obras'])) {
            $obras = $body['obras'];
            if (count($obras) === 0) {
                Response::json(['ok' => true, 'eliminados' => 0]);
            }
            $marcadores = implode(',', array_fill(0, count($obras), '?'));
            $stmt = $db->prepare("DELETE FROM presupuestos_en_estudio WHERE obra IN ($marcadores)");
            $stmt->execute($obras);
            Response::json(['ok' => true, 'eliminados' => $stmt->rowCount()]);
        }

        $obrasActivas = $body['obras_activas'] ?? null;
        if (!is_array($obrasActivas)) {
            Response::error('Falta "obras_activas" (array)', 422);
        }

        // Lista vacía nunca borra nada: evita que un fallo de lectura de
        // Drive (folder vacío, error silencioso) termine vaciando la tabla.
        if (count($obrasActivas) === 0) {
            Response::json(['ok' => true, 'eliminados' => 0]);
        }

        $marcadores = implode(',', array_fill(0, count($obrasActivas), '?'));
        $estatusReconciliables = "'" . implode("','", array_merge(ESTATUS_PRE_ENVIO, ['Pdt Aprobación'])) . "'";
        $stmt = $db->prepare("
            DELETE FROM presupuestos_en_estudio
            WHERE estatus IN ($estatusReconciliables)
              AND obra NOT IN ($marcadores)
        ");
        $stmt->execute($obrasActivas);

        Response::json(['ok' => true, 'eliminados' => $stmt->rowCount()]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
