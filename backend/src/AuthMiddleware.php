<?php
declare(strict_types=1);

final class AuthMiddleware
{
    public static function usuarioActual(string $secret): array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/', $header, $m)) {
            Response::error('Falta token de acceso', 401);
        }

        try {
            return Jwt::decode($m[1], $secret);
        } catch (RuntimeException $e) {
            Response::error('Token inválido o expirado', 401);
        }
    }

    public static function requierePermiso(array $usuario, string $permiso): void
    {
        if (!in_array($permiso, $usuario['permisos'] ?? [], true)) {
            Response::error('No autorizado para esta acción', 403);
        }
    }
}
