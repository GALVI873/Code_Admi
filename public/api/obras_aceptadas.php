<?php
declare(strict_types=1);

// Lista de obras en "SEGUIMIENTO DE OBRAS (Aceptadas)" para el espacio de
// trabajo de Alfredo (Gestión de Obras) — ver
// backend/drive_sync/sync_obras_aceptadas.js.
//
// Independiente de presupuestos_en_estudio a propósito: se confirmó que esa
// tabla NO sigue a la obra una vez que Geraldinne la mueve fuera de "en
// estudio" — esta es su propia fuente de verdad, leída directo del Excel de
// cálculo que vive en la carpeta de la obra ya aceptada.
//
// El Excel trae, en la hoja "Ficha", dos columnas: "PRESUPUESTO" (el dato
// original, columna B — lo que guarda obras_aceptadas) y "CONFIRMACIÓN"
// (columna C, vacía siempre — nadie la usa desde Excel). Alfredo confirma o
// corrige cada campo desde el panel; cada confirmación es su propia fila en
// obra_aceptada_confirmaciones (no una columna más en obras_aceptadas,
// porque son datos de origen distinto: uno lo trae la sincronización con
// Drive, el otro lo decide una persona) y
// backend/drive_sync/escribir_confirmaciones_aceptadas.js las escribe de
// vuelta en la columna "Confirmación" del Excel real.
//
// Cada obra trae además "tiene_mensajes_sin_leer" (bool), calculado igual
// que en presupuestos_en_estudio.php contra comentarios_obra/
// comentarios_obra_leido (el mismo hilo de mensajes entre Álvaro/Geraldinne/
// Alfredo — ver comentarios_obra.php) — alimenta la pestaña "Notas" del
// detalle de obra y la insignia de "sin leer" en la tarjeta.
//
// GET: lista obras + confirmaciones (requiere sesión + obras.ver_aceptadas).
// PATCH: {obra, campo, valor} — Alfredo confirma/corrige un campo puntual de
// una obra (requiere sesión + obras.ver_aceptadas). "campo" tiene que ser
// uno de los confirmables (ver CAMPOS_CONFIRMABLES); cualquier otro se
// rechaza. Con {obra, campo, eliminar:true} se deshace la confirmación
// (vuelve el campo a sin confirmar, por si se tocó ✓ sin querer).
// PATCH {obra, estatus}: cambia el estatus de seguimiento de la obra
// (Activo/Repasos/Terminada, ver ESTATUS_ACEPTADA_VALIDOS) — puesto siempre
// a mano desde la lista; vive en la propia columna obras_aceptadas.estatus,
// no en obra_aceptada_confirmaciones, así que el UPDATE de la
// sincronización de más abajo no lo toca y sobrevive a la próxima corrida
// sin necesitar tabla aparte. Una obra nueva arranca en "Activo" por
// defecto (ver migración idempotente más abajo).
// PATCH {obra, marcar_vista:true}: apaga la insignia "Nueva" (es_nueva) al
// abrir el detalle por primera vez — ver traspasar_obras_aceptadas.js para
// cómo se pone en 1.
// PATCH {obra, guardar_direccion:true, direccion, localidad, contacto_nombre,
// telefono, email}: Dirección/contacto de la obra, a pedido de Álvaro —
// dato 100% manual (no sale de ningún Excel ni de Drive, a diferencia del
// resto de esta página), por eso vive en su propia tabla
// (obra_direccion_contacto) en vez de una columna más de obras_aceptadas:
// si fuera columna de obras_aceptadas, el UPSERT de la sincronización de
// más abajo la pisaría con NULL en la próxima corrida (ese INSERT/UPDATE
// siempre manda todos los campos que conoce, y Drive no sabe nada de
// dirección/contacto). Guardando en tabla aparte, la sincronización ni la
// toca — mismo motivo por el que "estatus"/"es_nueva" quedan afuera del
// UPDATE de la sincronización en vez de protegidas ahí mismo.
// POST: {accion:"listar"} lectura administrativa para el script de
// escritura (protegido por SYNC_TOKEN, sin sesión). Upsert de una obra
// puntual, usado por la sincronización con Drive (mismo token).
// Reconciliación: {accion:"reconciliar", obras:[...]} borra las que ya no
// están en el recorrido (la obra pudo pasar a facturación/cierre y salir de
// la carpeta) — incluidas sus confirmaciones.

$config = require __DIR__ . '/../../backend/bootstrap.php';

const CAMPOS_CONFIRMABLES = [
    'proveedor', 'color_carpinteria', 'correderas', 'abatibles', 'vidrio',
    'ral', 'persiana', 'color_persiana', 'modelo_lamas', 'motor_radio', 'motor_mecanico',
];

// Estatus de seguimiento de la obra ya aceptada (no confunde con el
// estatus de Presupuestos en Estudio, es un campo propio de esta tabla) —
// se pone siempre a mano desde la lista, por defecto "Activo" en cuanto
// una obra nueva llega acá.
const ESTATUS_ACEPTADA_VALIDOS = ['Activo', 'Repasos', 'Terminada'];

// Mismo hilo de comentarios que usa Presupuestos en Estudio
// (comentarios_obra.php) — acá alimenta la pestaña "Notas" del detalle de
// obra aceptada. Se identifica por nombre BASE de la obra por consistencia
// con el resto (una obra aceptada normalmente no trae sufijo "— Opción
// A/B", pero si arrastra el mismo nombre que tenía en estudio, la
// conversación sigue siendo la misma).
function nombreBaseObra(string $obra): string
{
    return trim((string) preg_replace('/\s*—\s*Opci[oó]n\s+\w+\s*$/iu', '', $obra));
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS obras_aceptadas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL UNIQUE,
          categoria TEXT,
          contacto TEXT,
          cliente TEXT,
          no_ventanas INTEGER,
          numero_ppto TEXT,
          fecha_ppto TEXT,
          proveedor TEXT,
          color_carpinteria TEXT,
          correderas TEXT,
          abatibles TEXT,
          vidrio TEXT,
          ral TEXT,
          persiana TEXT,
          color_persiana TEXT,
          modelo_lamas TEXT,
          motor_radio TEXT,
          motor_mecanico TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Migraciones idempotentes: la tabla original (primera versión de esta
    // página) solo tenía carpinteria/ral/persiana/vidrio/proveedor y un
    // confirmado_en a nivel de obra — se suman las columnas nuevas sin
    // tocar filas existentes. carpinteria/confirmado_en quedan sin usar
    // (no se borran, esa columna nunca se elimina en SQLite sin recrear la
    // tabla) pero ya no las lee ni las escribe nada.
    $columnas = array_column($db->query('PRAGMA table_info(obras_aceptadas)')->fetchAll(), 'name');
    foreach (['fecha_ppto', 'color_carpinteria', 'correderas', 'abatibles', 'color_persiana', 'modelo_lamas', 'motor_radio', 'motor_mecanico', 'estatus'] as $columna) {
        if (!in_array($columna, $columnas, true)) {
            $db->exec("ALTER TABLE obras_aceptadas ADD COLUMN $columna TEXT");
        }
    }
    // Obras que ya existían antes de agregar esta columna (ALTER TABLE no
    // puede poner un default distinto de NULL sobre filas existentes en
    // SQLite) — se las deja en "Activo" igual que las nuevas, no en blanco.
    $db->exec("UPDATE obras_aceptadas SET estatus = 'Activo' WHERE estatus IS NULL");

    // "Nueva" — insignia para que Alfredo note de un vistazo qué obra recién
    // le llegó de traspasar_obras_aceptadas.js. Se pone en 1 SOLO en el
    // INSERT de una obra que nunca había existido (ver más abajo, columna
    // explícita con valor literal 1) — el ON CONFLICT DO UPDATE de la
    // sincronización normal no la toca a propósito, mismo criterio que
    // "estatus", así que sigue en 1 hasta que Alfredo la abre por primera
    // vez (ver PATCH {obra, marcar_vista:true} más abajo). DEFAULT 0 en el
    // ALTER para que las obras que ya existían no aparezcan como nuevas.
    if (!in_array('es_nueva', $columnas, true)) {
        $db->exec('ALTER TABLE obras_aceptadas ADD COLUMN es_nueva INTEGER NOT NULL DEFAULT 0');
    }

    $db->exec("
        CREATE TABLE IF NOT EXISTS obra_aceptada_confirmaciones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          campo TEXT NOT NULL,
          valor TEXT,
          confirmado_en TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(obra, campo)
        )
    ");

    // Definidas también acá (no solo en comentarios_obra.php) porque el GET
    // de abajo necesita leerlas para marcar qué obras tienen mensajes sin
    // leer — mismo criterio del resto del proyecto: cada archivo asegura las
    // tablas que toca, sin depender de qué endpoint las creó primero.
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
    $db->exec("
        CREATE TABLE IF NOT EXISTS obra_direccion_contacto (
          obra TEXT PRIMARY KEY,
          direccion TEXT,
          localidad TEXT,
          contacto_nombre TEXT,
          telefono TEXT,
          email TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra_leido (
          obra TEXT NOT NULL,
          usuario_email TEXT NOT NULL,
          ultima_lectura TEXT NOT NULL,
          PRIMARY KEY (obra, usuario_email)
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $obras = $db->query('SELECT * FROM obras_aceptadas ORDER BY obra')->fetchAll();
        $confirmaciones = $db->query('SELECT * FROM obra_aceptada_confirmaciones')->fetchAll();
        $direcciones = $db->query('SELECT * FROM obra_direccion_contacto')->fetchAll();

        // Insignia de "hay mensajes sin leer" por obra — mismo criterio que
        // presupuestos_en_estudio.php: último mensaje de la conversación
        // contra la última vez que ESTE usuario la abrió.
        $ultimoMensajePorObra = [];
        foreach ($db->query('SELECT obra, MAX(creado_en) AS ultimo FROM comentarios_obra GROUP BY obra')->fetchAll() as $r) {
            $ultimoMensajePorObra[$r['obra']] = $r['ultimo'];
        }
        $lecturaPorObra = [];
        $stmtLectura = $db->prepare('SELECT obra, ultima_lectura FROM comentarios_obra_leido WHERE usuario_email = ?');
        $stmtLectura->execute([$usuario['email']]);
        foreach ($stmtLectura->fetchAll() as $r) {
            $lecturaPorObra[$r['obra']] = $r['ultima_lectura'];
        }
        foreach ($obras as &$o) {
            $base = nombreBaseObra($o['obra']);
            $ultimo = $ultimoMensajePorObra[$base] ?? null;
            $leido = $lecturaPorObra[$base] ?? null;
            // "tiene_mensajes" (con o sin leer) alimenta el filtro rápido de
            // la lista ("obras con Notas"); "tiene_mensajes_sin_leer" sigue
            // siendo la insignia/punto rojo de notificación.
            $o['tiene_mensajes'] = $ultimo !== null;
            $o['tiene_mensajes_sin_leer'] = $ultimo !== null && ($leido === null || $ultimo > $leido);
        }
        unset($o);

        Response::json(['obras' => $obras, 'confirmaciones' => $confirmaciones, 'direcciones' => $direcciones]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));

        // Dirección/contacto — ver comentario grande de arriba. Se guardan
        // los 5 campos juntos siempre (el frontend manda el objeto completo
        // en cada guardado, no campo por campo) para no necesitar un
        // "campo" más en CAMPOS_CONFIRMABLES.
        if (($body['guardar_direccion'] ?? false) === true) {
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            // Misma clave (nombre BASE) que usa presupuestos_en_estudio.php
            // para esta misma tabla — una obra aceptada normalmente ya
            // viene sin sufijo "— Opción A/B", así que en la práctica no
            // cambia nada, pero así ambos endpoints escriben siempre
            // exactamente la misma fila.
            $obraBase = nombreBaseObra($obra);
            $direccion = trim((string) ($body['direccion'] ?? ''));
            $localidad = trim((string) ($body['localidad'] ?? ''));
            $contactoNombre = trim((string) ($body['contacto_nombre'] ?? ''));
            $telefono = trim((string) ($body['telefono'] ?? ''));
            $email = trim((string) ($body['email'] ?? ''));

            $db->prepare("
                INSERT INTO obra_direccion_contacto (obra, direccion, localidad, contacto_nombre, telefono, email, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(obra) DO UPDATE SET
                    direccion = excluded.direccion,
                    localidad = excluded.localidad,
                    contacto_nombre = excluded.contacto_nombre,
                    telefono = excluded.telefono,
                    email = excluded.email,
                    actualizado_en = datetime('now')
            ")->execute([
                $obraBase,
                $direccion === '' ? null : $direccion,
                $localidad === '' ? null : $localidad,
                $contactoNombre === '' ? null : $contactoNombre,
                $telefono === '' ? null : $telefono,
                $email === '' ? null : $email,
            ]);
            Response::json(['ok' => true]);
        }

        // Apaga la insignia "Nueva" — se llama sola al abrir el detalle de
        // la obra por primera vez (ver ObrasAceptadasPage.jsx).
        if (($body['marcar_vista'] ?? false) === true) {
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            $db->prepare("UPDATE obras_aceptadas SET es_nueva = 0 WHERE obra = ?")->execute([$obra]);
            Response::json(['ok' => true]);
        }

        // Estatus de seguimiento puesto a mano (Activo/Repasos/Terminada) —
        // vive directo en obras_aceptadas (no en obra_aceptada_confirmaciones,
        // eso es para los campos de la Ficha), la sincronización nunca lo
        // toca en el UPDATE de más abajo así que un cambio hecho acá
        // sobrevive a la próxima corrida sin necesitar tabla aparte.
        if (array_key_exists('estatus', $body) && !array_key_exists('campo', $body)) {
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            $estatus = trim((string) $body['estatus']);
            if (!in_array($estatus, ESTATUS_ACEPTADA_VALIDOS, true)) {
                Response::error('"estatus" debe ser uno de: ' . implode(', ', ESTATUS_ACEPTADA_VALIDOS), 422);
            }
            $db->prepare("UPDATE obras_aceptadas SET estatus = ?, actualizado_en = datetime('now') WHERE obra = ?")
                ->execute([$estatus, $obra]);
            Response::json(['ok' => true]);
        }

        $campo = trim((string) ($body['campo'] ?? ''));
        if ($obra === '' || $campo === '') {
            Response::error('Faltan "obra" y/o "campo"', 422);
        }
        if (!in_array($campo, CAMPOS_CONFIRMABLES, true)) {
            Response::error('"campo" debe ser uno de: ' . implode(', ', CAMPOS_CONFIRMABLES), 422);
        }

        // Deshacer una confirmación (por si se tocó ✓ sin querer): vuelve el
        // campo a su estado sin confirmar, no deja un valor vacío guardado.
        if ($body['eliminar'] ?? false) {
            $db->prepare('DELETE FROM obra_aceptada_confirmaciones WHERE obra = ? AND campo = ?')
                ->execute([$obra, $campo]);
            Response::json(['ok' => true]);
        }

        $valor = trim((string) ($body['valor'] ?? ''));

        $db->prepare("
            INSERT INTO obra_aceptada_confirmaciones (obra, campo, valor, confirmado_en)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(obra, campo) DO UPDATE SET
                valor = excluded.valor,
                confirmado_en = datetime('now')
        ")->execute([$obra, $campo, $valor === '' ? null : $valor]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'listar') {
            $obras = $db->query('SELECT * FROM obras_aceptadas')->fetchAll();
            $confirmaciones = $db->query('SELECT * FROM obra_aceptada_confirmaciones')->fetchAll();
            Response::json(['obras' => $obras, 'confirmaciones' => $confirmaciones]);
        }

        if (($body['accion'] ?? '') === 'reconciliar') {
            $obras = $body['obras'] ?? null;
            if (!is_array($obras)) {
                Response::error('Falta "obras" (array)', 422);
            }
            if (count($obras) === 0) {
                Response::json(['ok' => true, 'eliminadas' => 0]);
            }
            $marcadores = implode(',', array_fill(0, count($obras), '?'));
            $stmt = $db->prepare("DELETE FROM obras_aceptadas WHERE obra NOT IN ($marcadores)");
            $stmt->execute($obras);
            $db->prepare("DELETE FROM obra_aceptada_confirmaciones WHERE obra NOT IN ($marcadores)")->execute($obras);
            Response::json(['ok' => true, 'eliminadas' => $stmt->rowCount()]);
        }

        $obra = trim((string) ($body['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        // Todos los campos se actualizan siempre con lo último que traiga
        // Drive — a diferencia de otras tablas del panel, acá no hace falta
        // proteger nada del lado del UPSERT: lo que Alfredo confirma vive
        // en obra_aceptada_confirmaciones, una tabla aparte que esta
        // sincronización ni toca.
        $stmt = $db->prepare("
            INSERT INTO obras_aceptadas
                (obra, categoria, contacto, cliente, no_ventanas, numero_ppto, fecha_ppto, proveedor, color_carpinteria, correderas, abatibles, vidrio, ral, persiana, color_persiana, modelo_lamas, motor_radio, motor_mecanico, es_nueva, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(obra) DO UPDATE SET
                categoria = excluded.categoria,
                contacto = excluded.contacto,
                cliente = excluded.cliente,
                no_ventanas = excluded.no_ventanas,
                numero_ppto = excluded.numero_ppto,
                fecha_ppto = excluded.fecha_ppto,
                proveedor = excluded.proveedor,
                color_carpinteria = excluded.color_carpinteria,
                correderas = excluded.correderas,
                abatibles = excluded.abatibles,
                vidrio = excluded.vidrio,
                ral = excluded.ral,
                persiana = excluded.persiana,
                color_persiana = excluded.color_persiana,
                modelo_lamas = excluded.modelo_lamas,
                motor_radio = excluded.motor_radio,
                motor_mecanico = excluded.motor_mecanico,
                actualizado_en = datetime('now')
        ");
        $stmt->execute([
            $obra,
            $body['categoria'] ?? null,
            $body['contacto'] ?? null,
            $body['cliente'] ?? null,
            $body['no_ventanas'] ?? null,
            $body['numero_ppto'] ?? null,
            $body['fecha_ppto'] ?? null,
            $body['proveedor'] ?? null,
            $body['color_carpinteria'] ?? null,
            $body['correderas'] ?? null,
            $body['abatibles'] ?? null,
            $body['vidrio'] ?? null,
            $body['ral'] ?? null,
            $body['persiana'] ?? null,
            $body['color_persiana'] ?? null,
            $body['modelo_lamas'] ?? null,
            $body['motor_radio'] ?? null,
            $body['motor_mecanico'] ?? null,
        ]);

        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
