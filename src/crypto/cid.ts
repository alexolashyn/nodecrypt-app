import { importer } from 'ipfs-unixfs-importer';
import { fixedSize } from 'ipfs-unixfs-importer/chunker';
import { balanced } from 'ipfs-unixfs-importer/layout';
import { CID } from 'multiformats/cid';

export const CID_PROFILE = {
  cidVersion: 1,
  rawLeaves: true,
  chunkSize: 262_144,
  maxChildrenPerNode: 174,
} as const;

const discardBlocks = { put: (cid: CID) => cid };

async function* readBlob(blob: Blob): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export const computeCid = async (content: Blob): Promise<CID> => {
  let root: CID | undefined;
  for await (const entry of importer(
    [{ content: readBlob(content) }],
    discardBlocks,
    {
      cidVersion: CID_PROFILE.cidVersion,
      rawLeaves: CID_PROFILE.rawLeaves,
      reduceSingleLeafToSelf: true,
      chunker: fixedSize({ chunkSize: CID_PROFILE.chunkSize }),
      layout: balanced({ maxChildrenPerNode: CID_PROFILE.maxChildrenPerNode }),
    },
  )) {
    root = entry.cid;
  }
  if (!root) throw new Error('Importer produced no CID');
  return root;
};

export const cidToBytes = (cid: CID): Uint8Array => cid.bytes;

export const cidFromBytes = (bytes: Uint8Array): CID => CID.decode(bytes);
