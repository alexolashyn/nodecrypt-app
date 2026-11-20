import { describe, expect, it } from 'vitest';
import type { Bytes } from '../bytes';
import { CID_PROFILE, cidFromBytes, computeCid } from '../cid';

const BACKEND_VECTORS: Array<[number, string]> = [
  [1, 'bafkreidogqfzz75tpkmjzjke425xqcrmpcib2p5tg44hnbirumdbpl5adu'],
  [1000, 'bafkreiaeukrgmf62txn3bnsm5qvwa6oszv3az5ygshpamnksybxkrukt4i'],
  [262143, 'bafkreia2fdficwq6uhshly4epczy6sxujlwfsp26kvajt3a6u5z3mjya3a'],
  [262144, 'bafkreifitlnc66kaij6yxlgy6jznu643c7esj5on6xy7cr4a4ybi7t6pam'],
  [262145, 'bafybeidyva6znzoavidz5ccqounlb6cshsm7gdvniskoryxpfy4plh46z4'],
  [798777, 'bafybeid37c45fu7ekwit7uovncqj4vimxn5yforedepminfd4h3cgzjbo4'],
  [45613056, 'bafybeigamesslwernawy3ei52gm4pmadtrsef55p6l7vdsivsiwso6b57m'],
  [45613057, 'bafybeierkwkjbgdmgz4wvmaashmnmbfe6rz3wv77bwc3x6crm3t7nkpb4y'],
];

const pattern = (length: number): Bytes => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = (i * 31 + (i >>> 8) + (i >>> 16)) & 0xff;
  }
  return bytes;
};

describe('computeCid', () => {
  it('uses the backend import profile', () => {
    expect(CID_PROFILE).toEqual({
      cidVersion: 1,
      rawLeaves: true,
      chunkSize: 262144,
      maxChildrenPerNode: 174,
    });
  });

  it.each(BACKEND_VECTORS)(
    'matches the backend CID for %i bytes',
    async (length, expected) => {
      const cid = await computeCid(new Blob([pattern(length)]));
      expect(cid.toString()).toBe(expected);
    },
    60_000,
  );

  it('does not depend on how the blob is split into parts', async () => {
    const bytes = pattern(3 * 262144 + 12345);
    const parts = [bytes.slice(0, 7), bytes.slice(7, 300_001), bytes.slice(300_001)];
    const whole = await computeCid(new Blob([bytes]));
    const split = await computeCid(new Blob(parts));
    expect(split.equals(whole)).toBe(true);
  });

  it('round-trips through the binary form stored on-chain', async () => {
    const cid = await computeCid(new Blob([pattern(1000)]));
    expect(cidFromBytes(cid.bytes).equals(cid)).toBe(true);
  });
});
