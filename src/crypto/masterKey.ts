import { CHAIN_ID } from '@/config';
import { type Bytes, randomBytes, utf8, wipe } from './bytes';

export const masterKeyAad = (
  address: string,
  keyVersion: number,
  mkVersion: number,
): Bytes => {
  return utf8(
    `nodecrypt|mk|${address.toLowerCase()}|${CHAIN_ID}|kv=${keyVersion}|mk=${mkVersion}`,
  );
};

export const generateMasterKeyBytes = (): Bytes => {
  return randomBytes(32);
};

export const importMasterKey = async (bytes: Bytes): Promise<CryptoKey> => {
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);

  wipe(bytes);

  return key;
};
