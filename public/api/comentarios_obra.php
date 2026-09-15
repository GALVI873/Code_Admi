<?php
declare(strict_types=1);

// Hilo de mensajes entre Álvaro, Geraldinne y Alfredo sobre una obra
// puntual —
// reemplaza el viejo "comentario_geraldinne" de presupuestos_en_estudio.php
// (un solo campo de texto, de un solo sentido: ella escribía, él solo leía).
// Se identifica por el nombre BASE de la obra (sin el sufijo "— Opción A/B"),
// no por el id de presupuestos_en_estudio: una obra con varias opciones
// vivas es, para efectos de esta conversación, un solo proyecto — no tiene
// sentido partir la charla en dos según qué opción esté abierta en cada
// momento. La misma normalización de nombre vive en el frontend
// (ComentariosObra.jsx) y acá, para que ambos lados siempre lleguen a la
// misma clave sin importar qué variante de obra les llegó.
//
// No es chat en tiempo real (no hay websockets en este panel): el hilo se
// arma con GET al abrir el detalle de la obra y se refresca al reabrir o
// recargar, no empuja mensajes nuevos solo.
//
// GET ?obra=... : requiere sesión + (presupuestos.ver_todos,
// presupuestos.ver_seguimiento u obras.ver_aceptadas) — cualquiera de los
// tres, mismo criterio que el resto de presupuestos_en_estudio.php /
// obras_aceptadas.php. Se usa tanto en el detalle de una obra en estudio
// como en el de una obra aceptada (pestaña "Notas": Álvaro deja ahí lo que
// saca de una reunión o visita a obra, Alfredo lo ve sin que se lo tengan
// que repetir a mano). Devuelve el hilo completo, más
// viejo primero, y de paso marca la conversación como leída por este
// usuario (comentarios_obra_leido) — abrir el hilo ES la señal de lectura,
// no hace falta una acción aparte.
// POST {obra, mensaje}: mismo permiso, agrega un mensaje atribuido al
// usuario de la sesión (nombre/email del JWT, no un campo del body). También
// marca la conversación como leída por quien escribe, para que su propio
// mensaje no le quede marcado como "sin leer" a sí mismo.
//
// comentarios_obra_leido guarda, por obra + usuario, la fecha del último
// vistazo — presupuestos_en_estudio.php la usa para decidir qué tarjetas
// muestran la insignia de "mensajes nuevos".
//
// "hecho" (columna nueva): en la pestaña "Notas" de Obras Aceptadas, cada
// mensaje que Álvaro deja funciona como un pendiente para Alfredo — Alfredo
// lo tilda cuando ya lo resolvió. Solo Alfredo (rol gestion_obras) puede
// tildar, a pedido explícito (Álvaro no marca sus propios mensajes). No se
// usa en las otras dos vistas que comparten este mismo endpoint
// (Presupuestos en Estudio/Presupuesto son charla libre entre Álvaro y
// Geraldinne, no pendientes) — ahí el campo simplemente queda siempre en 0.
// "archivado" (columna nueva): también solo para la pestaña "Notas" — una
// vez que Alfredo terminó con una nota (comentada y/o hecha), la archiva
// para que deje de aparecer en la lista sin borrarla. GET la excluye por
// defecto; ?incluir_archivadas=1 las vuelve a traer (por si hace falta
// revisar o desarchivar alguna).
// "categoria" (columna nueva, 'tarea' | 'recordatorio'): a pedido de
// Álvaro, Alfredo separa sus notas en dos paneles (arrastrando la
// burbuja de uno a otro) — toda nota nueva arranca en 'tarea' (valor por
// defecto de la columna), tanto en la pestaña "Notas" de una obra como en
// la vista general "Pendientes".
// comentarios_obra_respuestas: hilo corto de respuestas colgado de una nota
// puntual (comentario_id) — a diferencia de la nota en sí, que es de
// Álvaro, acá cualquiera de los dos puede escribir (típicamente Alfredo
// contestando esa nota puntual, sin abrir una nota nueva aparte).
// PATCH {id, hecho} y/o {id, archivado} y/o {id, categoria}: requiere
// sesión + rol gestion_obras (hecho, específicamente Alfredo) o
// gestion_obras/admin (archivado y categoria, cualquiera de los dos).
// POST {obra, mensaje, comentario_id?}: sin comentario_id crea una nota
// nueva (comportamiento de siempre); con comentario_id agrega una
// respuesta a esa nota puntual en comentarios_obra_respuestas.
// GET ?pendientes=1 (sin "obra"): junta, de TODAS las obras que están en
// obras_aceptadas, los mensajes que no son de Alfredo y siguen sin marcar
// "hecho" — la vista "Pendientes" (control general de Alfredo, no tiene
// que entrar obra por obra). Requiere sesión + obras.ver_aceptadas.
// DELETE ?obra=...: TEMPORAL, solo para pruebas — vacía la conversación
// completa de una obra (borra todos sus mensajes y su registro de
// lectura). Requiere sesión + rol admin. Se agregó a pedido explícito
// mientras se prueba esta función con Alfredo; sacar cuando ya no haga
// falta reiniciar conversaciones de prueba.

$config = require __DIR__ . '/../../backend/bootstrap.php';

function nombreBaseObra(string $obra): string
{
    return trim((string) preg_replace('/\s*—\s*Opci[oó]n\s+\w+\s*$/iu', '', $obra));
}

function tieneRol(array $usuario, string $rol): bool
{
    return in_array($rol, $usuario['roles'] ?? [], true);
}

function marcarLeido(PDO $db, string $obra, string $email): void
{
    $db->prepare("
        INSERT INTO comentarios_obra_leido (obra, usuario_email, ultima_lectura)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(obra, usuario_email) DO UPDATE SET ultima_lectura = excluded.ultima_lectura
    ")->execute([$obra, $email]);
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          autor_nombre TEXT NOT NULL,
          autor_email TEXT NOT NULL,
          mensaje TEXT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $columnasComentarios = array_column($db->query('PRAGMA table_info(comentarios_obra)')->fetchAll(), 'name');
    if (!in_array('hecho', $columnasComentarios, true)) {
        $db->exec('ALTER TABLE comentarios_obra ADD COLUMN hecho INTEGER NOT NULL DEFAULT 0');
    }
    if (!in_array('archivado', $columnasComentarios, true)) {
        $db->exec('ALTER TABLE comentarios_obra ADD COLUMN archivado INTEGER NOT NULL DEFAULT 0');
    }
    if (!in_array('categoria', $columnasComentarios, true)) {
        $db->exec("ALTER TABLE comentarios_obra ADD COLUMN categoria TEXT NOT NULL DEFAULT 'tarea'");
    }
    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra_leido (
          obra TEXT NOT NULL,
          usuario_email TEXT NOT NULL,
          ultima_lectura TEXT NOT NULL,
          PRIMARY KEY (obra, usuario_email)
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra_respuestas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          comentario_id INTEGER NOT NULL,
          autor_nombre TEXT NOT NULL,
          autor_email TEXT NOT NULL,
          mensaje TEXT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // TEMPORAL — a pedido de Álvaro (2026-09-15): se les borró sin querer
    // la marca de "sin leer" de lo que Alfredo contestó hoy mientras
    // buscaban algo en el panel. Sin sesión, protegido por SYNC_TOKEN.
    // Sacar cuando ya no haga falta.
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $bodyDebug = json_decode((string) file_get_contents('php://input'), true) ?? [];
        if (($bodyDebug['accion'] ?? '') === 'debug_resetear_no_leido_hoy') {
            $tokenDebug = $_GET['token'] ?? $bodyDebug['token'] ?? '';
            if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $tokenDebug)) {
                Response::error('No autorizado', 403);
            }
            $obrasDirectas = array_column($db->query("
                SELECT DISTINCT obra FROM comentarios_obra
                WHERE LOWER(autor_nombre) = 'alfredo' AND date(creado_en) = date('now')
            ")->fetchAll(), 'obra');
            $obrasRespuestas = array_column($db->query("
                SELECT DISTINCT co.obra
                FROM comentarios_obra_respuestas r
                INNER JOIN comentarios_obra co ON co.id = r.comentario_id
                WHERE LOWER(r.autor_nombre) = 'alfredo' AND date(r.creado_en) = date('now')
            ")->fetchAll(), 'obra');
            $obrasAfectadas = array_values(array_unique(array_merge($obrasDirectas, $obrasRespuestas)));
            if (count($obrasAfectadas) > 0) {
                $marcadores = implode(',', array_fill(0, count($obrasAfectadas), '?'));
                $db->prepare("DELETE FROM comentarios_obra_leido WHERE obra IN ($marcadores)")->execute($obrasAfectadas);
            }
            Response::json(['obras' => $obrasAfectadas]);
        }
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requiereAlgunPermiso($usuario, ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento', 'obras.ver_aceptadas']);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // Vista "Pendientes": todas las obras aceptadas juntas, no una en
        // particular — Alfredo no tiene que entrar obra por obra.
        if (($_GET['pendientes'] ?? '') === '1') {
            AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');
            $stmt = $db->query("
                SELECT co.*, oa.id AS obra_id
                FROM comentarios_obra co
                INNER JOIN obras_aceptadas oa ON oa.obra = co.obra
                WHERE co.hecho = 0
                  AND co.archivado = 0
                  AND co.autor_email NOT IN (
                    SELECT u.email FROM usuarios u
                    INNER JOIN usuario_roles ur ON ur.usuario_id = u.id
                    INNER JOIN roles r ON r.id = ur.rol_id
                    WHERE r.nombre = 'gestion_obras'
                  )
                ORDER BY co.creado_en ASC, co.id ASC
            ");
            Response::json(['comentarios' => $stmt->fetchAll()]);
        }

        $obra = nombreBaseObra((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }
        $incluirArchivadas = ($_GET['incluir_archivadas'] ?? '') === '1';
        $sql = 'SELECT * FROM comentarios_obra WHERE obra = ?' . ($incluirArchivadas ? '' : ' AND archivado = 0') . ' ORDER BY creado_en ASC, id ASC';
        $stmt = $db->prepare($sql);
        $stmt->execute([$obra]);
        $comentarios = $stmt->fetchAll();

        // Respuestas colgadas de cada nota (ver comentario de cabecera) —
        // se traen todas juntas en una sola consulta y se reparten acá en
        // vez de una consulta por nota.
        if ($comentarios) {
            $ids = array_column($comentarios, 'id');
            $marcadores = implode(',', array_fill(0, count($ids), '?'));
            $stmtR = $db->prepare("SELECT * FROM comentarios_obra_respuestas WHERE comentario_id IN ($marcadores) ORDER BY creado_en ASC, id ASC");
            $stmtR->execute($ids);
            $respuestasPorComentario = [];
            foreach ($stmtR->fetchAll() as $r) {
                $respuestasPorComentario[$r['comentario_id']][] = $r;
            }
            foreach ($comentarios as &$c) {
                $c['respuestas'] = $respuestasPorComentario[$c['id']] ?? [];
            }
            unset($c);
        }

        marcarLeido($db, $obra, $usuario['email']);

        Response::json(['comentarios' => $comentarios]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = nombreBaseObra((string) ($body['obra'] ?? ''));
        $mensaje = trim((string) ($body['mensaje'] ?? ''));
        if ($obra === '' || $mensaje === '') {
            Response::error('Faltan "obra" y/o "mensaje"', 422);
        }

        $comentarioId = (int) ($body['comentario_id'] ?? 0);
        if ($comentarioId > 0) {
            // Respuesta colgada de una nota puntual, no una nota nueva.
            $db->prepare('INSERT INTO comentarios_obra_respuestas (comentario_id, autor_nombre, autor_email, mensaje) VALUES (?, ?, ?, ?)')
                ->execute([$comentarioId, $usuario['nombre'], $usuario['email'], $mensaje]);

            $id = (int) $db->lastInsertId();
            $stmt = $db->prepare('SELECT * FROM comentarios_obra_respuestas WHERE id = ?');
            $stmt->execute([$id]);

            marcarLeido($db, $obra, $usuario['email']);

            Response::json(['respuesta' => $stmt->fetch()]);
        }

        $db->prepare('INSERT INTO comentarios_obra (obra, autor_nombre, autor_email, mensaje) VALUES (?, ?, ?, ?)')
            ->execute([$obra, $usuario['nombre'], $usuario['email'], $mensaje]);

        $id = (int) $db->lastInsertId();
        $stmt = $db->prepare('SELECT * FROM comentarios_obra WHERE id = ?');
        $stmt->execute([$id]);

        marcarLeido($db, $obra, $usuario['email']);

        Response::json(['comentario' => $stmt->fetch()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        $tieneAlgunCambio = array_key_exists('hecho', $body) || array_key_exists('archivado', $body) || array_key_exists('categoria', $body);
        if ($id <= 0 || !$tieneAlgunCambio) {
            Response::error('Falta "id" y "hecho" y/o "archivado" y/o "categoria"', 422);
        }

        if (array_key_exists('hecho', $body)) {
            if (!tieneRol($usuario, 'gestion_obras')) {
                Response::error('Solo Alfredo puede marcar un pendiente como hecho', 403);
            }
            $db->prepare('UPDATE comentarios_obra SET hecho = ? WHERE id = ?')
                ->execute([$body['hecho'] ? 1 : 0, $id]);
        }

        if (array_key_exists('archivado', $body)) {
            if (!tieneRol($usuario, 'gestion_obras') && !tieneRol($usuario, 'admin')) {
                Response::error('No tenés permiso para archivar esta nota', 403);
            }
            $db->prepare('UPDATE comentarios_obra SET archivado = ? WHERE id = ?')
                ->execute([$body['archivado'] ? 1 : 0, $id]);
        }

        if (array_key_exists('categoria', $body)) {
            if (!tieneRol($usuario, 'gestion_obras') && !tieneRol($usuario, 'admin')) {
                Response::error('No tenés permiso para categorizar esta nota', 403);
            }
            $categoria = (string) $body['categoria'];
            if (!in_array($categoria, ['tarea', 'recordatorio'], true)) {
                Response::error('"categoria" tiene que ser "tarea" o "recordatorio"', 422);
            }
            $db->prepare('UPDATE comentarios_obra SET categoria = ? WHERE id = ?')
                ->execute([$categoria, $id]);
        }

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        // TEMPORAL — botón de prueba para reiniciar una conversación (ver
        // comentario de cabecera). Sacar cuando ya no haga falta.
        if (!tieneRol($usuario, 'admin')) {
            Response::error('Solo un administrador puede vaciar una conversación', 403);
        }
        $obra = nombreBaseObra((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }
        $stmtIds = $db->prepare('SELECT id FROM comentarios_obra WHERE obra = ?');
        $stmtIds->execute([$obra]);
        $ids = array_column($stmtIds->fetchAll(), 'id');
        if ($ids) {
            $marcadores = implode(',', array_fill(0, count($ids), '?'));
            $db->prepare("DELETE FROM comentarios_obra_respuestas WHERE comentario_id IN ($marcadores)")->execute($ids);
        }
        $db->prepare('DELETE FROM comentarios_obra WHERE obra = ?')->execute([$obra]);
        $db->prepare('DELETE FROM comentarios_obra_leido WHERE obra = ?')->execute([$obra]);
        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
