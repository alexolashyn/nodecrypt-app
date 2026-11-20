const readChainId = (): number => {
  const value = Number(import.meta.env.VITE_CHAIN_ID);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('VITE_CHAIN_ID is missing or not a positive integer');
  }

  return value;
};

const readAddress = (name: string): string => {
  const value = import.meta.env[name] as string | undefined;

  if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? '')) {
    throw new Error(`${name} is missing or malformed`);
  }

  return value!;
};

const readGatewayUrls = (): string[] => {
  const value = (import.meta.env.VITE_IPFS_GATEWAY_URL as string | undefined) ?? '';
  const urls = value
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (urls.length === 0 || !urls.every((url) => /^https?:\/\//.test(url))) {
    throw new Error('VITE_IPFS_GATEWAY_URL is missing or not a list of http(s) URLs');
  }

  return urls;
};

export const CHAIN_ID = readChainId();
export const PROFILE_REGISTRY_ADDRESS = readAddress(
  'VITE_PROFILE_REGISTRY_ADDRESS',
);
export const FILE_REGISTRY_ADDRESS = readAddress('VITE_FILE_REGISTRY_ADDRESS');
export const STORAGE_TIER_ADDRESS = readAddress('VITE_STORAGE_TIER_ADDRESS');
export const IPFS_GATEWAY_URLS = readGatewayUrls();
