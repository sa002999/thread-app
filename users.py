"""Email normalization and password hashing for local accounts."""

import hashlib
import hmac
import re
import secrets


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 5


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if len(normalized) > 254 or not _EMAIL.fullmatch(normalized):
        raise ValueError("請輸入有效的 Email")
    return normalized


def hash_password(password: str) -> str:
    if not 8 <= len(password) <= 128:
        raise ValueError("密碼須為 8–128 個字元")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, maxmem=64 * 1024 * 1024
    )
    return f"scrypt:{_SCRYPT_N}:{_SCRYPT_R}:{_SCRYPT_P}:{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if len(password) > 128:
        return False
    try:
        algorithm, n, r, p, salt, expected = stored.split(":")
        if (algorithm, int(n), int(r), int(p)) != ("scrypt", _SCRYPT_N, _SCRYPT_R, _SCRYPT_P):
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt),
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
            maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, UnicodeError):
        return False
