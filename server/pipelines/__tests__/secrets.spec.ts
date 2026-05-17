import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../internal/secrets.js';

describe('encrypt/decrypt', () => {
  it('round-trips a plaintext string', () => {
    const original = 'my-secret-pat-token-12345';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':'); // iv:tag:data format
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const original = 'same-input';
    const a = encrypt(original);
    const b = encrypt(original);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(original);
    expect(decrypt(b)).toBe(original);
  });

  it('handles empty strings', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  it('handles unicode', () => {
    const original = 'secret-with-émojis-🔑';
    expect(decrypt(encrypt(original))).toBe(original);
  });
});
