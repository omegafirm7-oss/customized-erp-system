import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { BadRequestException } from "@nestjs/common";

/**
 * AES-256-GCM envelope encryption for ZATCA private keys and CSID secrets
 * at rest. Format: base64(iv):base64(authTag):base64(ciphertext).
 * The 32-byte key comes from the ZATCA_KEY_ENCRYPTION_KEY environment
 * variable (base64 or hex). GCM gives tamper detection for free.
 */

function loadKey(rawKey: string): Buffer {
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    key = Buffer.from(rawKey, "hex");
  } else {
    key = Buffer.from(rawKey, "base64");
  }
  if (key.length !== 32) {
    throw new BadRequestException(
      "ZATCA_KEY_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex)",
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(encrypted: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const [ivB64, tagB64, dataB64] = encrypted.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new BadRequestException("Malformed encrypted secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
