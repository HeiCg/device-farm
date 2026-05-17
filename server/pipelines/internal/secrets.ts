import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16; // 128-bit auth tag (GCM maximum)

function getEncryptionKey(): Buffer {
  const key = process.env.DEVICE_FARM_SECRET_KEY;
  if (!key) {
    // Fallback: derive from a static default (not secure for production, but functional)
    return Buffer.from('device-farm-default-secret-key!!'); // exactly 32 bytes
  }
  const buf = Buffer.from(key);
  if (buf.length === 32) return buf;
  return createHash('sha256').update(key).digest();
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = encoded.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export class SecretsService {
  constructor(private readonly db: Database) {}

  async create(name: string, value: string): Promise<{ name: string }> {
    const encryptedValue = encrypt(value);
    await this.db.insert(schema.pipelineSecrets).values({
      name,
      encryptedValue,
    });
    return { name };
  }

  async get(name: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(schema.pipelineSecrets)
      .where(eq(schema.pipelineSecrets.name, name));
    if (!row) return null;
    return decrypt(row.encryptedValue);
  }

  async list(): Promise<Array<{ name: string; createdAt: Date }>> {
    const rows = await this.db
      .select({
        name: schema.pipelineSecrets.name,
        createdAt: schema.pipelineSecrets.createdAt,
      })
      .from(schema.pipelineSecrets);
    return rows;
  }

  async delete(name: string): Promise<void> {
    await this.db
      .delete(schema.pipelineSecrets)
      .where(eq(schema.pipelineSecrets.name, name));
  }
}
