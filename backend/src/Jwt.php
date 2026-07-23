<?php
declare(strict_types=1);

final class Jwt
{
    // Firmamos y verificamos siempre con HS256 fijo (no leemos "alg" del token) para
    // no quedar expuestos a ataques de confusión de algoritmo (ej. token con "alg: none").
    public static function encode(array $payload, string $secret): string
    {
        $header = self::base64UrlEncode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
        $body = self::base64UrlEncode(json_encode($payload));
        $signature = self::sign("$header.$body", $secret);
        return "$header.$body.$signature";
    }

    public static function decode(string $token, string $secret): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new RuntimeException('Token con formato inválido');
        }
        [$header, $body, $signature] = $parts;

        $expected = self::sign("$header.$body", $secret);
        if (!hash_equals($expected, $signature)) {
            throw new RuntimeException('Firma inválida');
        }

        $payload = json_decode(self::base64UrlDecode($body), true);
        if (!is_array($payload)) {
            throw new RuntimeException('Payload inválido');
        }
        if (isset($payload['exp']) && time() >= $payload['exp']) {
            throw new RuntimeException('Token expirado');
        }
        return $payload;
    }

    private static function sign(string $data, string $secret): string
    {
        return self::base64UrlEncode(hash_hmac('sha256', $data, $secret, true));
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
    }
}
