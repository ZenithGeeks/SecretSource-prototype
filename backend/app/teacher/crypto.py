"""Encryption boundary for persisted Google refresh tokens."""

from cryptography.fernet import Fernet


class RefreshTokenCipher:
    """Encrypt and decrypt only at the server-side OAuth/sync boundary."""

    def __init__(self, key: str | bytes):
        self._fernet = Fernet(key.encode() if isinstance(key, str) else key)

    def encrypt(self, refresh_token: str) -> str:
        return self._fernet.encrypt(refresh_token.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._fernet.decrypt(ciphertext.encode()).decode()
