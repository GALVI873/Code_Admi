<?php
declare(strict_types=1);

// GET: lista los presupuestos en estudio (requiere sesión + presupuestos.ver_todos
// o presupuestos.ver_seguimiento).
// POST: upsert de un registro, usado por el proceso de sincronización con Drive
// (protegido por SYNC_TOKEN, no por sesión de usuario — es máquina a máquina).
// Con {accion:"listar"} devuelve obra/estatus/fecha_ultimo_envio de todas las
// filas (lectura administrativa, sin sesión). Con {accion:"marcar_estatus",
// obras:[...], estatus:"..."} hace limpieza en bloque (pisa el estatus sin
// importar cuál tenía, a diferencia del upsert). Con
// {accion:"sincronizar_ofertas_detectadas", obra:"...", ofertas:[...]} empareja
// lo leído de la carpeta "Valoración" contra las solicitudes "Pendiente" que
// Geraldinne ya había cargado (ver PATCH abajo) en vez de reemplazar todo —
// así no se pisa lo que ella cargó a mano.
// PATCH: cambia prioridad, interesante, estatus, el comentario/fecha límite de
// Geraldinne, y/o gestiona sus solicitudes de valoración a proveedor:
//   - "prioridad" requiere el permiso presupuestos.gestionar_prioridad (solo admin).
//   - "interesante" requiere presupuestos.marcar_interesante (solo admin — Álvaro/Valentina).
//   - "estatus" requiere ver_todos o ver_seguimiento (cualquiera que pueda ver la tabla).
//   - "comentario_geraldinne"/"fecha_limite_entrega" requieren presupuestos.ver_seguimiento
//     (solo Geraldinne — Álvaro las ve en su vista pero no las edita).
//   - {accion:"agregar_solicitud_oferta", obra, proveedor, fecha_solicitud},
//     {accion:"eliminar_oferta", oferta_id} y {accion:"cambiar_estatus_oferta",
//     oferta_id, estatus:"Pendiente"|"No recibido"} requieren
//     presupuestos.ver_seguimiento (solo Geraldinne). "Recibido" nunca se
//     pone a mano, solo lo pone la sincronización con Drive.
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

// Sin tildes/mayúsculas ni signos, para poder comparar "Villar" con
// "Aluminios Villar, SL." o "ALUMINIOS VILLAR" sin depender de que el
// nombre que escribió Geraldinne y el que se detectó en el PDF coincidan
// letra por letra. Mapa explícito (no iconv//TRANSLIT) para no depender del
// soporte de locales del hosting.
function normalizarProveedor(string $s): string
{
    $s = mb_strtolower($s, 'UTF-8');
    $s = strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', 'ü' => 'u']);
    return preg_replace('/[^a-z0-9]/', '', $s);
}

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
          interesante INTEGER NOT NULL DEFAULT 0,
          numero_ppto TEXT,
          carpinteria TEXT,
          proveedor TEXT,
          fecha_creacion_carpeta TEXT,
          fecha_ultimo_envio TEXT,
          comentario_geraldinne TEXT,
          fecha_limite_entrega TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Ofertas de proveedor de cada obra — relación 1 a N. Geraldinne
    // registra a mano a quién le pidió valoración (estatus "Pendiente", solo
    // fecha_solicitud); si el proveedor rechaza el pedido o nunca contesta,
    // ella misma la pasa a "No recibido". Cuando la sincronización con Drive
    // encuentra el PDF correspondiente en la carpeta "Valoración", esa fila
    // pasa a "Recibido" con valor/fecha/archivo/fecha_llegada — ese último
    // paso nunca se hace a mano, solo lo pone la sincronización. Si no hay
    // ninguna fila abierta (Pendiente o No recibido) que le calce, se crea
    // igual como "Recibido" (no se pierde una oferta real detectada solo
    // porque no se había registrado el pedido) — ver
    // accion:"sincronizar_ofertas_detectadas" más abajo.
    $db->exec("
        CREATE TABLE IF NOT EXISTS ofertas_proveedor (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          proveedor TEXT,
          valor REAL,
          fecha TEXT,
          archivo TEXT,
          estatus TEXT NOT NULL DEFAULT 'Recibido',
          fecha_solicitud TEXT,
          fecha_llegada TEXT,
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
    if (!in_array('interesante', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN interesante INTEGER NOT NULL DEFAULT 0');
    }
    if (!in_array('numero_ppto', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN numero_ppto TEXT');
    }
    if (!in_array('carpinteria', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN carpinteria TEXT');
    }
    if (!in_array('proveedor', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN proveedor TEXT');
    }
    if (!in_array('fecha_creacion_carpeta', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN fecha_creacion_carpeta TEXT');
    }
    if (!in_array('comentario_geraldinne', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN comentario_geraldinne TEXT');
    }
    if (!in_array('fecha_limite_entrega', $columnas, true)) {
        $db->exec('ALTER TABLE presupuestos_en_estudio ADD COLUMN fecha_limite_entrega TEXT');
    }

    $columnasOfertas = array_column($db->query('PRAGMA table_info(ofertas_proveedor)')->fetchAll(), 'name');
    if (!in_array('estatus', $columnasOfertas, true)) {
        $db->exec("ALTER TABLE ofertas_proveedor ADD COLUMN estatus TEXT NOT NULL DEFAULT 'Recibido'");
    }
    if (!in_array('fecha_solicitud', $columnasOfertas, true)) {
        $db->exec('ALTER TABLE ofertas_proveedor ADD COLUMN fecha_solicitud TEXT');
    }
    if (!in_array('fecha_llegada', $columnasOfertas, true)) {
        $db->exec('ALTER TABLE ofertas_proveedor ADD COLUMN fecha_llegada TEXT');
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

    // Marcar obras de alto interés (estrella de favorito) — exclusivo de
    // Álvaro y Valentina, ambos con rol admin, igual que gestionar_prioridad.
    $db->exec("INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES ('presupuestos.marcar_interesante', 'Marcar un presupuesto en estudio como de alto interés')");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'admin' AND p.clave = 'presupuestos.marcar_interesante'
    ");

    // Página "Presupuesto": espacio de trabajo de Geraldinne, única persona
    // con el rol 'presupuestos'. Permiso propio (no ver_todos) para que no
    // se le abra de paso la vista de Presupuestos en Estudio de admin — esa
    // sigue exigiendo ver_todos exclusivamente.
    $db->exec("INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES ('presupuestos.ver_seguimiento', 'Ver la línea de tiempo de obras en la página Presupuesto')");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'presupuestos' AND p.clave = 'presupuestos.ver_seguimiento'
    ");
    // Revertir el ver_todos que se le había dado por error al rol
    // 'presupuestos' en un cambio anterior — con ver_seguimiento ya no hace
    // falta, y ver_todos le abría de paso Presupuestos en Estudio.
    $db->exec("
        DELETE FROM rol_permisos
        WHERE rol_id = (SELECT id FROM roles WHERE nombre = 'presupuestos')
          AND permiso_id = (SELECT id FROM permisos WHERE clave = 'presupuestos.ver_todos')
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requiereAlgunPermiso($usuario, ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento']);

        // Más reciente a más antiguo por fecha de envío; las obras sin envío
        // (fecha_ultimo_envio NULL) quedan al final (SQLite ordena NULL como
        // el valor más chico, así que en DESC caen últimas).
        $stmt = $db->query('SELECT * FROM presupuestos_en_estudio ORDER BY fecha_ultimo_envio DESC');
        $ofertas = $db->query('SELECT * FROM ofertas_proveedor ORDER BY obra, fecha DESC')->fetchAll();
        Response::json(['presupuestos' => $stmt->fetchAll(), 'ofertas' => $ofertas]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];

        // Solicitudes de valoración a proveedor (obra de Geraldinne, no de
        // presupuestos_en_estudio) — van por "accion" en vez de "id" porque
        // no editan una fila de esa tabla.
        if (($body['accion'] ?? '') === 'agregar_solicitud_oferta') {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $obra = trim((string) ($body['obra'] ?? ''));
            $proveedor = trim((string) ($body['proveedor'] ?? ''));
            $fechaSolicitud = trim((string) ($body['fecha_solicitud'] ?? ''));
            if ($obra === '' || $proveedor === '') {
                Response::error('Faltan "obra" y/o "proveedor"', 422);
            }
            if ($fechaSolicitud !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaSolicitud)) {
                Response::error('"fecha_solicitud" debe tener formato AAAA-MM-DD', 422);
            }
            $db->prepare("
                INSERT INTO ofertas_proveedor (obra, proveedor, estatus, fecha_solicitud, actualizado_en)
                VALUES (?, ?, 'Pendiente', ?, datetime('now'))
            ")->execute([$obra, $proveedor, $fechaSolicitud === '' ? null : $fechaSolicitud]);
            Response::json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
        }

        if (($body['accion'] ?? '') === 'eliminar_oferta') {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $ofertaId = (int) ($body['oferta_id'] ?? 0);
            if ($ofertaId <= 0) {
                Response::error('Falta "oferta_id"', 422);
            }
            $db->prepare('DELETE FROM ofertas_proveedor WHERE id = ?')->execute([$ofertaId]);
            Response::json(['ok' => true]);
        }

        // "No recibido": el proveedor rechazó el pedido o nunca contestó.
        // Solo se puede pasar entre "Pendiente" y "No recibido" a mano —
        // "Recibido" queda reservado para cuando la sincronización encuentra
        // de verdad el PDF en la carpeta "Valoración" (ver
        // sincronizar_ofertas_detectadas más abajo), nunca se pone a mano.
        if (($body['accion'] ?? '') === 'cambiar_estatus_oferta') {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $ofertaId = (int) ($body['oferta_id'] ?? 0);
            $estatusOferta = trim((string) ($body['estatus'] ?? ''));
            if ($ofertaId <= 0) {
                Response::error('Falta "oferta_id"', 422);
            }
            if (!in_array($estatusOferta, ['Pendiente', 'No recibido'], true)) {
                Response::error('"estatus" debe ser "Pendiente" o "No recibido"', 422);
            }
            $db->prepare("UPDATE ofertas_proveedor SET estatus = ?, actualizado_en = datetime('now') WHERE id = ? AND estatus != 'Recibido'")
                ->execute([$estatusOferta, $ofertaId]);
            Response::json(['ok' => true]);
        }

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

        if (array_key_exists('interesante', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.marcar_interesante');
            $interesante = $body['interesante'] ? 1 : 0;
            $db->prepare("UPDATE presupuestos_en_estudio SET interesante = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$interesante, $id]);
        }

        if (array_key_exists('estatus', $body)) {
            AuthMiddleware::requiereAlgunPermiso($usuario, ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento']);
            $estatus = trim((string) $body['estatus']);
            if (!in_array($estatus, ESTATUS_VALIDOS, true)) {
                Response::error('"estatus" debe ser una de: ' . implode(', ', ESTATUS_VALIDOS), 422);
            }
            $db->prepare("UPDATE presupuestos_en_estudio SET estatus = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$estatus, $id]);
        }

        if (array_key_exists('comentario_geraldinne', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $comentario = trim((string) $body['comentario_geraldinne']);
            $db->prepare("UPDATE presupuestos_en_estudio SET comentario_geraldinne = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$comentario === '' ? null : $comentario, $id]);
        }

        if (array_key_exists('fecha_limite_entrega', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $fecha = trim((string) $body['fecha_limite_entrega']);
            if ($fecha !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
                Response::error('"fecha_limite_entrega" debe tener formato AAAA-MM-DD', 422);
            }
            $db->prepare("UPDATE presupuestos_en_estudio SET fecha_limite_entrega = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$fecha === '' ? null : $fecha, $id]);
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

        // Empareja lo detectado en la carpeta "Valoración" de la obra contra
        // lo que ya hay en la tabla, en vez de borrar todo y volver a
        // insertar (eso pisaba las solicitudes "Pendiente" que Geraldinne
        // había cargado a mano). Por cada oferta detectada:
        //   1) si ya existe una fila con el mismo archivo (de una corrida
        //      anterior), se actualiza en vez de duplicar;
        //   2) si no, se busca una fila de esa obra que todavía no esté
        //      "Recibido" (o sea "Pendiente" o "No recibido" — un proveedor
        //      que se había dado por perdido puede terminar contestando)
        //      cuyo proveedor calce (comparación sin tildes/mayúsculas, en
        //      cualquier dirección) y se completa esa fila;
        //   3) si no hay ninguna de las dos, se crea igual como "Recibido"
        //      (mejor mostrar una oferta real sin solicitud registrada que
        //      perderla) — Geraldinne puede borrarla a mano si no corresponde.
        if (($body['accion'] ?? '') === 'sincronizar_ofertas_detectadas') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $detectadas = $body['ofertas'] ?? null;
            if ($obra === '' || !is_array($detectadas)) {
                Response::error('Faltan "obra" y/o "ofertas" (array)', 422);
            }

            $stmtPendientes = $db->prepare("SELECT * FROM ofertas_proveedor WHERE obra = ? AND estatus != 'Recibido'");
            $stmtPendientes->execute([$obra]);
            $pendientes = $stmtPendientes->fetchAll();
            $usadas = [];
            $nuevas = 0;
            $actualizadas = 0;

            foreach ($detectadas as $d) {
                $proveedor = $d['proveedor'] ?? null;
                $valor = $d['valor'] ?? null;
                $fecha = $d['fecha'] ?? null;
                $archivo = $d['archivo'] ?? null;
                $fechaLlegada = $d['fecha_llegada'] ?? null;

                $existente = null;
                if ($archivo !== null) {
                    $stmt = $db->prepare('SELECT * FROM ofertas_proveedor WHERE obra = ? AND archivo = ?');
                    $stmt->execute([$obra, $archivo]);
                    $existente = $stmt->fetch() ?: null;
                }

                if ($existente) {
                    $db->prepare("
                        UPDATE ofertas_proveedor
                        SET proveedor = COALESCE(?, proveedor), valor = ?, fecha = ?, fecha_llegada = ?, estatus = 'Recibido', actualizado_en = datetime('now')
                        WHERE id = ?
                    ")->execute([$proveedor, $valor, $fecha, $fechaLlegada, $existente['id']]);
                    $actualizadas++;
                    continue;
                }

                $match = null;
                if ($proveedor !== null) {
                    $detectadoNorm = normalizarProveedor($proveedor);
                    foreach ($pendientes as $p) {
                        if (in_array($p['id'], $usadas, true)) {
                            continue;
                        }
                        $pendienteNorm = normalizarProveedor((string) $p['proveedor']);
                        if ($pendienteNorm !== '' && (str_contains($detectadoNorm, $pendienteNorm) || str_contains($pendienteNorm, $detectadoNorm))) {
                            $match = $p;
                            break;
                        }
                    }
                }

                if ($match) {
                    $usadas[] = $match['id'];
                    $db->prepare("
                        UPDATE ofertas_proveedor
                        SET valor = ?, fecha = ?, fecha_llegada = ?, archivo = ?, estatus = 'Recibido', actualizado_en = datetime('now')
                        WHERE id = ?
                    ")->execute([$valor, $fecha, $fechaLlegada, $archivo, $match['id']]);
                    $actualizadas++;
                    continue;
                }

                $db->prepare("
                    INSERT INTO ofertas_proveedor (obra, proveedor, valor, fecha, archivo, fecha_llegada, estatus, actualizado_en)
                    VALUES (?, ?, ?, ?, ?, ?, 'Recibido', datetime('now'))
                ")->execute([$obra, $proveedor, $valor, $fecha, $archivo, $fechaLlegada]);
                $nuevas++;
            }

            Response::json(['ok' => true, 'nuevas' => $nuevas, 'actualizadas' => $actualizadas]);
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
                (obra, cliente, estatus, no_ventanas, precio_m2, ral, persiana, vidrio, numero_ppto, carpinteria, proveedor, precio_ultimo_presupuesto, porcentaje_ganancia, fecha_ultimo_envio, fecha_creacion_carpeta, categoria, contacto, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
                numero_ppto = excluded.numero_ppto,
                carpinteria = excluded.carpinteria,
                proveedor = excluded.proveedor,
                precio_ultimo_presupuesto = excluded.precio_ultimo_presupuesto,
                porcentaje_ganancia = excluded.porcentaje_ganancia,
                fecha_ultimo_envio = excluded.fecha_ultimo_envio,
                fecha_creacion_carpeta = excluded.fecha_creacion_carpeta,
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
            $body['numero_ppto'] ?? null,
            $body['carpinteria'] ?? null,
            $body['proveedor'] ?? null,
            $body['precio_ultimo_presupuesto'] ?? null,
            $body['porcentaje_ganancia'] ?? null,
            $body['fecha_ultimo_envio'] ?? null,
            $body['fecha_creacion_carpeta'] ?? null,
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
