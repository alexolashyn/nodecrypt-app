import { type Bytes, bytesToBigInt, bigIntToBytes, concatBytes } from './bytes';

export const CURVE_P =
  0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
export const CURVE_A = CURVE_P - 3n;
export const CURVE_B =
  0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
export const CURVE_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const PKCS8_P256_PREFIX = new Uint8Array([
  0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
  0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
]);

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;

  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }

  return result;
};

export const compressPoint = (x: Uint8Array, y: Uint8Array): Bytes => {
  if (x.length !== 32) {
    throw new Error(`compressPoint: x must be 32 bytes, got ${x.length}`);
  }
  if (y.length !== 32) {
    throw new Error(`compressPoint: y must be 32 bytes, got ${y.length}`);
  }

  const prefix = (y[31] & 1) === 1 ? 0x03 : 0x02;

  return concatBytes(new Uint8Array([prefix]), x);
};

export const decompressPoint = (x: Uint8Array, yOdd: boolean): Bytes => {
  if (x.length !== 32) {
    throw new Error(`decompressPoint: x must be 32 bytes, got ${x.length}`);
  }

  const xInt = bytesToBigInt(x);
  if (xInt >= CURVE_P) {
    throw new Error('decompressPoint: x is outside the field');
  }

  const rhs = (modPow(xInt, 3n, CURVE_P) + CURVE_A * xInt + CURVE_B) % CURVE_P;

  const y = modPow(rhs, (CURVE_P + 1n) / 4n, CURVE_P);

  if ((y * y) % CURVE_P !== rhs) {
    throw new Error('decompressPoint: x is not on the P-256 curve');
  }

  const resolvedY = ((y & 1n) === 1n) === yOdd ? y : CURVE_P - y;

  return concatBytes(new Uint8Array([0x04]), x, bigIntToBytes(resolvedY, 32));
};

export const scalarToPkcs8 = (d: Uint8Array): Bytes => {
  if (d.length !== 32) {
    throw new Error(`scalarToPkcs8: scalar must be 32 bytes, got ${d.length}`);
  }

  return concatBytes(PKCS8_P256_PREFIX, d);
};

export const importPublicKey = (
  x: Uint8Array,
  yOdd: boolean,
): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'raw',
    decompressPoint(x, yOdd),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
};
