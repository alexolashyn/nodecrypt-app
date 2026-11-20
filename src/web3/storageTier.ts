import {
  Contract,
  type ContractTransactionReceipt,
  type InterfaceAbi,
  type Provider,
  type Signer,
} from 'ethers';
import { STORAGE_TIER_ADDRESS } from '@/config';
import { AppError } from '@/shared/errors';
import artifact from './abi/StorageTier.json';
import { createErrorDecoder, waitForReceipt } from './contractErrors';
import type { TierInfo } from './types';

const ABI = artifact.abi as InterfaceAbi;

const CONTRACT_ERROR_KEYS: Record<string, string> = {
  InvalidPeriods: 'errors:tier.invalidPeriods',
  PaymentDisabled: 'errors:tier.paymentDisabled',
  IncorrectEthAmount: 'errors:tier.incorrectEthAmount',
  EnforcedPause: 'errors:tier.paused',
};

const getContract = (runner: Provider | Signer): Contract => {
  return new Contract(STORAGE_TIER_ADDRESS, ABI, runner);
};

export const getPricePerPeriod = async (provider: Provider): Promise<bigint> => {
  return getContract(provider).pricePerPeriod() as Promise<bigint>;
};

export const getMaxFileBytes = async (
  provider: Provider,
  address: string,
): Promise<bigint> => {
  return getContract(provider).maxFileBytes(address) as Promise<bigint>;
};

export const getTierInfo = async (
  provider: Provider,
  address: string,
): Promise<TierInfo> => {
  const contract = getContract(provider);
  const [
    isPremium,
    premiumUntil,
    maxFileBytes,
    freeMaxFileBytes,
    premiumMaxFileBytes,
    pricePerPeriod,
    periodSeconds,
    maxPeriods,
    paused,
  ] = await Promise.all([
    contract.isPremium(address),
    contract.premiumUntil(address),
    contract.maxFileBytes(address),
    contract.freeMaxFileBytes(),
    contract.premiumMaxFileBytes(),
    contract.pricePerPeriod(),
    contract.periodSeconds(),
    contract.MAX_PERIODS(),
    contract.paused(),
  ]);

  return {
    isPremium: isPremium as boolean,
    premiumUntil: Number(premiumUntil),
    maxFileBytes: maxFileBytes as bigint,
    freeMaxFileBytes: freeMaxFileBytes as bigint,
    premiumMaxFileBytes: premiumMaxFileBytes as bigint,
    pricePerPeriod: pricePerPeriod as bigint,
    periodSeconds: Number(periodSeconds),
    maxPeriods: Number(maxPeriods),
    paused: paused as boolean,
  };
};

export const buyPremiumEth = async (
  signer: Signer,
  periods: number,
  expectedPricePerPeriod: bigint,
): Promise<ContractTransactionReceipt> => {
  const contract = getContract(signer);
  const price = (await contract.pricePerPeriod()) as bigint;

  if (price === 0n) {
    throw new AppError('errors:tier.paymentDisabled');
  }
  if (price !== expectedPricePerPeriod) {
    throw new AppError('errors:tier.priceChanged');
  }

  const tx = await contract.buyPremiumEth(periods, {
    value: price * BigInt(periods),
  });
  return waitForReceipt(tx);
};

export const decodeStorageTierError = createErrorDecoder(ABI, CONTRACT_ERROR_KEYS);
