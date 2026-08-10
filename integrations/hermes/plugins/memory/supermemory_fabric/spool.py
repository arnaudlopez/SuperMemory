"""Crash-safe local delivery queue for minimized governed captures."""

import json
import hashlib
import os
import pathlib
import tempfile
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class DurableCaptureSpool:
    AAD = b"supermemory.hermes-capture-spool.v1"

    def __init__(self, directory, *, encryption_key):
        self.directory = pathlib.Path(directory).expanduser().resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        material = bytes(encryption_key) if not isinstance(encryption_key, str) else encryption_key.encode("utf-8")
        if len(material) < 32:
            raise ValueError("supermemory_spool_key_invalid")
        self._cipher = AESGCM(hashlib.sha256(material).digest())

    def enqueue(self, payload):
        identifier = f"capture_{uuid.uuid4().hex}"
        destination = self.directory / f"{identifier}.json.aead"
        descriptor, temporary = tempfile.mkstemp(prefix=".capture-", dir=self.directory)
        try:
            os.fchmod(descriptor, 0o600)
            nonce = os.urandom(12)
            plaintext = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            sealed = nonce + self._cipher.encrypt(nonce, plaintext, self.AAD)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(sealed)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return identifier

    def pending(self):
        for source in sorted(self.directory.glob("capture_*.json.aead")):
            stat = source.lstat()
            if source.is_symlink() or not source.is_file() or stat.st_mode & 0o077:
                raise ValueError("supermemory_spool_file_invalid")
            sealed = source.read_bytes()
            if len(sealed) < 29:
                raise ValueError("supermemory_spool_payload_invalid")
            try:
                plaintext = self._cipher.decrypt(sealed[:12], sealed[12:], self.AAD)
                payload = json.loads(plaintext.decode("utf-8"))
            except Exception as error:
                raise ValueError("supermemory_spool_payload_invalid") from error
            yield source, payload

    def acknowledge(self, source):
        pathlib.Path(source).unlink(missing_ok=True)
