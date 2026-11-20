import {
  Contract,
  type ContractTransactionReceipt,
  type InterfaceAbi,
  type Provider,
  type Signer,
} from 'ethers';
import { PROFILE_REGISTRY_ADDRESS } from '@/config';
import artifact from './abi/ProfileRegistry.json';
import { createErrorDecoder, waitForReceipt } from './contractErrors';
import type { Profile } from './types';

const ABI = artifact.abi as InterfaceAbi;

const CONTRACT_ERROR_KEYS: Record<string, string> = {
  ProfileAlreadyExists: 'errors:contract.profileAlreadyExists',
  ProfileNotFound: 'errors:contract.profileNotFound',
  InvalidPublicKey: 'errors:contract.invalidPublicKey',
  InvalidWrappedKey: 'errors:contract.invalidWrappedKey',
  IdentityKeyUnchanged: 'errors:contract.identityKeyUnchanged',
};

const getContract = (runner: Provider | Signer): Contract => {
  return new Contract(PROFILE_REGISTRY_ADDRESS, ABI, runner);
};

export const hasProfile = async (
  provider: Provider,
  address: string,
): Promise<boolean> => {
  return getContract(provider).hasProfile(address) as Promise<boolean>;
};

export const getProfile = async (
  provider: Provider,
  address: string,
): Promise<Profile> => {
  const raw = await getContract(provider).getProfile(address);

  return {
    pubKeyX: raw.pubKeyX as string,
    pubKeyYOdd: raw.pubKeyYOdd as boolean,
    wrappedMasterKey: raw.wrappedMasterKey as string,
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
    keyVersion: Number(raw.keyVersion),
    mkVersion: Number(raw.mkVersion),
    exists: raw.exists as boolean,
  };
};

export const registerProfile = async (
  signer: Signer,
  pubKeyXHex: string,
  pubKeyYOdd: boolean,
  wrappedMasterKeyHex: string,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).registerProfile(
    pubKeyXHex,
    pubKeyYOdd,
    wrappedMasterKeyHex,
  );
  return waitForReceipt(tx);
};

export const rotateIdentity = async (
  signer: Signer,
  pubKeyXHex: string,
  pubKeyYOdd: boolean,
  wrappedMasterKeyHex: string,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).rotateIdentity(
    pubKeyXHex,
    pubKeyYOdd,
    wrappedMasterKeyHex,
  );
  return waitForReceipt(tx);
};

export const rotateMasterKey = async (
  signer: Signer,
  wrappedMasterKeyHex: string,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).rotateMasterKey(wrappedMasterKeyHex);
  return waitForReceipt(tx);
};

export const decodeContractError = createErrorDecoder(ABI, CONTRACT_ERROR_KEYS);
