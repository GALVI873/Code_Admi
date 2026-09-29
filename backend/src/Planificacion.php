<?php
declare(strict_types=1);

// Lógica compartida de Planificación de obras — la usan planificacion.php
// (alta manual y "Calcular fechas") y presupuestos_en_estudio.php (alta
// automática al pasar un presupuesto a "Aceptado").
//
// Cronograma tipo a partir de la fecha de aceptación (a pedido de Álvaro,
// 2026-09-29). "+N" son días corridos desde la aceptación; la duración son
// días HÁBILES (lunes a viernes). Si un inicio cae en fin de semana se
// adelanta al viernes anterior.
//   Medición     aceptación + 7,  3 días
//   Material     aceptación + 21, 2 días
//   Fabricación  aceptación + 23, 5 días
//   Chapas       aceptación + 23, 5 días
//   Composite    aceptación + 23, 5 días
//   Transporte   3 viajes de 1 día: fin de Fabricación + 2, y dos más cada
//                3 días (+5 y +8)
//   Grúa         primer día de Montaje, 1 día
//   Montaje      mismo día que el primer Transporte, 5 días
//   Facturar     día siguiente al fin de Montaje, 5 días
final class Planificacion
{
    public const CATEGORIAS = ['Medición', 'Material', 'Fabricación', 'Chapas', 'Composite', 'Transporte', 'Grúa', 'Montaje', 'Facturar', 'Varios'];
    // Las que se crean solas al dar de alta una obra sin fecha de aceptación
    // ("Varios" queda para agregar a mano si hace falta).
    public const CATEGORIAS_ALTA = ['Medición', 'Material', 'Fabricación', 'Chapas', 'Composite', 'Transporte', 'Grúa', 'Montaje', 'Facturar'];

    public static function asegurarTablas(PDO $db): void
    {
        $db->exec("
            CREATE TABLE IF NOT EXISTS planificacion_obras (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nombre TEXT NOT NULL,
              constructora TEXT,
              obra_panel TEXT,
              tipo TEXT,
              situacion TEXT,
              silicona TEXT,
              comentario TEXT,
              estado TEXT NOT NULL DEFAULT 'Activa',
              creado_por TEXT,
              creado_en TEXT NOT NULL DEFAULT (datetime('now')),
              actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ");
        $columnas = array_column($db->query('PRAGMA table_info(planificacion_obras)')->fetchAll(), 'name');
        if (!in_array('fecha_aceptacion', $columnas, true)) {
            $db->exec('ALTER TABLE planificacion_obras ADD COLUMN fecha_aceptacion TEXT');
        }
        $db->exec("
            CREATE TABLE IF NOT EXISTS planificacion_tareas (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              obra_id INTEGER NOT NULL,
              categoria TEXT NOT NULL,
              fecha_inicio TEXT,
              fecha_fin TEXT,
              responsable TEXT,
              estado TEXT NOT NULL DEFAULT 'Pendiente',
              comentario TEXT,
              notion_id TEXT UNIQUE,
              actualizado_por TEXT,
              actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY (obra_id) REFERENCES planificacion_obras(id) ON DELETE CASCADE
            )
        ");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_planificacion_tareas_obra ON planificacion_tareas(obra_id)');
    }

    private static function esFinde(DateTimeImmutable $d): bool
    {
        return (int) $d->format('N') >= 6;
    }

    private static function habilAnterior(DateTimeImmutable $d): DateTimeImmutable
    {
        while (self::esFinde($d)) {
            $d = $d->modify('-1 day');
        }
        return $d;
    }

    // Último día de un tramo de $dias días hábiles que empieza en $inicio.
    private static function finHabil(DateTimeImmutable $inicio, int $dias): DateTimeImmutable
    {
        $fin = $inicio;
        $contados = 1;
        while ($contados < $dias) {
            $fin = $fin->modify('+1 day');
            if (!self::esFinde($fin)) {
                $contados++;
            }
        }
        return $fin;
    }

    private static function tramo(string $categoria, DateTimeImmutable $inicioNominal, int $dias): array
    {
        $inicio = self::habilAnterior($inicioNominal);
        $fin = self::finHabil($inicio, $dias);
        return [
            'categoria' => $categoria,
            'fecha_inicio' => $inicio->format('Y-m-d'),
            'fecha_fin' => $dias > 1 ? $fin->format('Y-m-d') : null,
        ];
    }

    // Lista ordenada de tareas con fechas (Transporte aparece 3 veces).
    public static function cronogramaDesdeAceptacion(string $fechaAceptacion): array
    {
        $a = new DateTimeImmutable($fechaAceptacion);
        $medicion = self::tramo('Medición', $a->modify('+7 days'), 3);
        $material = self::tramo('Material', $a->modify('+21 days'), 2);
        $fabricacion = self::tramo('Fabricación', $a->modify('+23 days'), 5);
        $chapas = self::tramo('Chapas', $a->modify('+23 days'), 5);
        $composite = self::tramo('Composite', $a->modify('+23 days'), 5);

        $finFabricacion = new DateTimeImmutable($fabricacion['fecha_fin'] ?? $fabricacion['fecha_inicio']);
        $transportes = [];
        foreach ([2, 5, 8] as $dias) {
            $transportes[] = self::tramo('Transporte', $finFabricacion->modify("+$dias days"), 1);
        }
        $primerTransporte = new DateTimeImmutable($transportes[0]['fecha_inicio']);
        $montaje = self::tramo('Montaje', $primerTransporte, 5);
        $grua = self::tramo('Grúa', $primerTransporte, 1);
        $finMontaje = new DateTimeImmutable($montaje['fecha_fin'] ?? $montaje['fecha_inicio']);
        $facturar = self::tramo('Facturar', $finMontaje->modify('+1 day'), 5);

        return array_merge([$medicion, $material, $fabricacion, $chapas, $composite], $transportes, [$grua, $montaje, $facturar]);
    }

    public static function insertarTarea(PDO $db, int $obraId, array $t, ?string $autor): int
    {
        $db->prepare("
            INSERT INTO planificacion_tareas (obra_id, categoria, fecha_inicio, fecha_fin, responsable, estado, comentario, notion_id, actualizado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([
            $obraId,
            $t['categoria'],
            $t['fecha_inicio'] ?? null,
            $t['fecha_fin'] ?? null,
            $t['responsable'] ?? null,
            $t['estado'] ?? 'Pendiente',
            $t['comentario'] ?? null,
            $t['notion_id'] ?? null,
            $autor,
        ]);
        return (int) $db->lastInsertId();
    }

    // Da de alta una obra. Con fecha de aceptación, sus tareas ya salen con
    // el cronograma tipo; sin ella, una tarea vacía por categoría.
    public static function crearObra(PDO $db, array $datos, ?string $autor): int
    {
        $fechaAceptacion = $datos['fecha_aceptacion'] ?? null;
        $db->prepare("
            INSERT INTO planificacion_obras (nombre, constructora, obra_panel, tipo, situacion, silicona, comentario, fecha_aceptacion, creado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([
            $datos['nombre'],
            $datos['constructora'] ?? null,
            $datos['obra_panel'] ?? null,
            $datos['tipo'] ?? null,
            $datos['situacion'] ?? null,
            $datos['silicona'] ?? null,
            $datos['comentario'] ?? null,
            $fechaAceptacion,
            $autor,
        ]);
        $obraId = (int) $db->lastInsertId();
        $tareas = $fechaAceptacion
            ? self::cronogramaDesdeAceptacion($fechaAceptacion)
            : array_map(fn ($c) => ['categoria' => $c], self::CATEGORIAS_ALTA);
        foreach ($tareas as $t) {
            self::insertarTarea($db, $obraId, $t, $autor);
        }
        return $obraId;
    }

    // Recalcula las fechas de una obra ya creada desde su fecha de
    // aceptación. Solo toca tareas Pendiente (las Terminado quedan como
    // están); a cada tarea del cronograma le corresponde la siguiente tarea
    // existente de esa categoría, y si falta alguna (ej. el 2º y 3º
    // Transporte) se crea.
    public static function recalcularFechas(PDO $db, int $obraId, string $fechaAceptacion, ?string $autor): void
    {
        $stmt = $db->prepare('SELECT * FROM planificacion_tareas WHERE obra_id = ? ORDER BY id');
        $stmt->execute([$obraId]);
        $existentes = [];
        foreach ($stmt->fetchAll() as $t) {
            $existentes[$t['categoria']][] = $t;
        }
        $actualizar = $db->prepare("UPDATE planificacion_tareas SET fecha_inicio = ?, fecha_fin = ?, actualizado_por = ?, actualizado_en = datetime('now') WHERE id = ?");
        foreach (self::cronogramaDesdeAceptacion($fechaAceptacion) as $t) {
            $existente = isset($existentes[$t['categoria']]) ? array_shift($existentes[$t['categoria']]) : null;
            if ($existente === null) {
                self::insertarTarea($db, $obraId, $t, $autor);
            } elseif ($existente['estado'] !== 'Terminado') {
                $actualizar->execute([$t['fecha_inicio'], $t['fecha_fin'], $autor, $existente['id']]);
            }
        }
        $db->prepare("UPDATE planificacion_obras SET fecha_aceptacion = ?, actualizado_en = datetime('now') WHERE id = ?")
            ->execute([$fechaAceptacion, $obraId]);
    }
}
