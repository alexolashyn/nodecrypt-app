# NodeCrypt App

NodeCrypt is an end-to-end encrypted file storage dApp. This is its web client: files are encrypted in the browser before they leave the device, registered on-chain (Base Sepolia), and stored on IPFS through [nodecrypt-backend](../nodecrypt-backend). Neither the server nor the storage providers ever see plaintext or keys.

- **Identity** — signing in with an Ethereum wallet (SIWE); the encryption identity is a P-256 key derived from a wallet signature, so nothing secret is stored.
- **Encryption** — a master key sealed to the identity key (ECIES), a random key per file wrapped under the master key, AES-256-GCM in 1 MiB chunks for content and metadata.
- **Storage** — the file's CID, wrapped key and encrypted metadata go to `FileRegistry`; the encrypted bytes are pinned on IPFS and fetched back through public gateways.
- **Key rotation** — identity, master key, or full re-encryption of every file.

Built with React, Vite, Tailwind, ethers.js v6 and the Web Crypto API; available in English and Ukrainian.

## Setup

Requirements: Node.js 22.12+, a browser wallet such as MetaMask on Base Sepolia, a running [nodecrypt-backend](../nodecrypt-backend), and the contracts deployed from [nodecrypt-dapp](../nodecrypt-dapp).

```bash
npm ci
cp .env.example .env    # API URL, chain ID, contract addresses, IPFS gateways
npm run dev             # http://localhost:5173
```

`FILE_REGISTRY` and `STORAGE_TIER` addresses must match the ones the backend reads.

| Command | Purpose |
|---|---|
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest unit tests (crypto, CID, upload API) |
| `npm run lint` | ESLint |
