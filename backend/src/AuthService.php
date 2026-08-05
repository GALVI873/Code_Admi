<?php
declare(strict_types=1);

final class AuthService
{
    private PDO $db;
    private array $config;

    public function __construct(PDO $db, array $config)
    {
        $this->db = $db;
        $this->config = $config;
    }

    public function login(string $email, string $password, string $ip): array
    {
        if ($this->tooManyAttempts($email)) {
            throw new RuntimeException('Demasiados intentos fallidos. Intenta de nuevo en unos minutos.', 429);
        }

        $stmt = $this->db->prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1');
        $stmt->execute([$email]);
        $usuario = $stmt->fetch();

        if (!$usuario || !password_verify($password, $usuario['password_hash'])) {
            $this->registrarIntento($email, $ip, false);
            throw new RuntimeException('Credenciales inválidas', 401);
        }

        $this->registrarIntento($email, $ip, true);

        $roles = $this->rolesDe((int) $usuario['id']);
        $permisos = $this->permisosDe((int) $usuario['id']);

        $accessToken = Jwt::encode([
            'sub' => (int) $usuario['id'],
            'nombre' => $usuario['nombre'],
            'email' => $usuario['email'],
            'roles' => $roles,
            'permisos' => $permisos,
            'iat' => time(),
            'exp' => time() + $this->config['jwt']['access_ttl'],
        ], $this->config['jwt']['secret']);

        $refreshToken = $this->emitirRefreshToken((int) $usuario['id']);

        $this->auditar((int) $usuario['id'], 'login', $ip);

        return [
            'access_token' => $accessToken,
            'refresh_token' => $refreshToken,
            'usuario' => [
                'id' => (int) $usuario['id'],
                'nombre' => $usuario['nombre'],
                'email' => $usuario['email'],
                'roles' => $roles,
                'permisos' => $permisos,
            ],
        ];
    }

    public function refresh(string $refreshToken): array
    {
        $hash = hash('sha256', $refreshToken);
        $stmt = $this->db->prepare(
            'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revocado = 0 AND expira_en > ?'
        );
        $stmt->execute([$hash, date('Y-m-d H:i:s')]);
        $registro = $stmt->fetch();

        if (!$registro) {
            throw new RuntimeException('Refresh token inválido o expirado', 401);
        }

        // Rotación: el token usado queda revocado y se emite uno nuevo en cada refresh.
        $this->db->prepare('UPDATE refresh_tokens SET revocado = 1 WHERE id = ?')->execute([$registro['id']]);

        $usuarioId = (int) $registro['usuario_id'];
        $stmt = $this->db->prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1');
        $stmt->execute([$usuarioId]);
        $usuario = $stmt->fetch();
        if (!$usuario) {
            throw new RuntimeException('Usuario no encontrado o inactivo', 401);
        }

        $roles = $this->rolesDe($usuarioId);
        $permisos = $this->permisosDe($usuarioId);

        $accessToken = Jwt::encode([
            'sub' => $usuarioId,
            'nombre' => $usuario['nombre'],
            'email' => $usuario['email'],
            'roles' => $roles,
            'permisos' => $permisos,
            'iat' => time(),
            'exp' => time() + $this->config['jwt']['access_ttl'],
        ], $this->config['jwt']['secret']);

        $nuevoRefresh = $this->emitirRefreshToken($usuarioId);

        return ['access_token' => $accessToken, 'refresh_token' => $nuevoRefresh];
    }

    public function logout(string $refreshToken): void
    {
        $hash = hash('sha256', $refreshToken);
        $this->db->prepare('UPDATE refresh_tokens SET revocado = 1 WHERE token_hash = ?')->execute([$hash]);
    }

    private function emitirRefreshToken(int $usuarioId): string
    {
        $token = bin2hex(random_bytes(32));
        $hash = hash('sha256', $token);
        $expira = date('Y-m-d H:i:s', time() + $this->config['jwt']['refresh_ttl']);

        $this->db->prepare('INSERT INTO refresh_tokens (usuario_id, token_hash, expira_en) VALUES (?, ?, ?)')
            ->execute([$usuarioId, $hash, $expira]);

        return $token;
    }

    private function permisosDe(int $usuarioId): array
    {
        $stmt = $this->db->prepare(
            'SELECT DISTINCT p.clave FROM permisos p
             JOIN rol_permisos rp ON rp.permiso_id = p.id
             JOIN usuario_roles ur ON ur.rol_id = rp.rol_id
             WHERE ur.usuario_id = ?'
        );
        $stmt->execute([$usuarioId]);
        return array_column($stmt->fetchAll(), 'clave');
    }

    private function rolesDe(int $usuarioId): array
    {
        $stmt = $this->db->prepare(
            'SELECT r.nombre FROM roles r
             JOIN usuario_roles ur ON ur.rol_id = r.id
             WHERE ur.usuario_id = ?'
        );
        $stmt->execute([$usuarioId]);
        return array_column($stmt->fetchAll(), 'nombre');
    }

    private function tooManyAttempts(string $email): bool
    {
        $stmt = $this->db->prepare(
            'SELECT COUNT(*) AS n FROM intentos_login
             WHERE email = ? AND exitoso = 0 AND creado_en > ?'
        );
        $stmt->execute([$email, date('Y-m-d H:i:s', time() - 15 * 60)]);
        return (int) $stmt->fetch()['n'] >= 5;
    }

    private function registrarIntento(string $email, string $ip, bool $exitoso): void
    {
        $this->db->prepare('INSERT INTO intentos_login (email, ip, exitoso) VALUES (?, ?, ?)')
            ->execute([$email, $ip, $exitoso ? 1 : 0]);
    }

    private function auditar(int $usuarioId, string $accion, string $ip): void
    {
        $this->db->prepare('INSERT INTO auditoria (usuario_id, accion, ip) VALUES (?, ?, ?)')
            ->execute([$usuarioId, $accion, $ip]);
    }
}
