import {
  Interface,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
  type InterfaceAbi,
} from 'ethers';
import { AppError } from '@/shared/errors';

export type ErrorParams = (args: Record<string, unknown>) => Record<string, unknown>;

export interface ErrorMapping {
  key: string;
  params?: ErrorParams;
}

const extractRevertData = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidates = [
    (error as { data?: unknown }).data,
    ((error as { info?: { error?: { data?: unknown } } }).info?.error ?? {})
      .data,
    ((error as { error?: { data?: unknown } }).error ?? {}).data,
  ];

  return candidates.find(
    (value): value is string =>
      typeof value === 'string' && value.startsWith('0x') && value.length >= 10,
  );
};

export const createErrorDecoder = (
  abi: InterfaceAbi,
  mappings: Record<string, string | ErrorMapping>,
) => {
  const iface = new Interface(abi);

  return (error: unknown): AppError => {
    if (error instanceof AppError) return error;

    const code = (error as { code?: unknown } | null)?.code;

    if (code === 'ACTION_REJECTED') {
      return new AppError('errors:contract.rejected');
    }
    if (code === 'INSUFFICIENT_FUNDS') {
      return new AppError('errors:contract.insufficientFunds');
    }

    const data = extractRevertData(error);
    if (data) {
      try {
        const parsed = iface.parseError(data);
        const entry = parsed && mappings[parsed.name];
        if (parsed && entry) {
          const mapping = typeof entry === 'string' ? { key: entry } : entry;
          const args = Object.fromEntries(
            parsed.fragment.inputs.map((input, i) => [input.name, parsed.args[i]]),
          );
          return new AppError(mapping.key, parsed.name, mapping.params?.(args));
        }
      } catch {}
    }

    const detail = (error as { shortMessage?: unknown } | null)?.shortMessage;
    return new AppError(
      'errors:contract.unknown',
      typeof detail === 'string' ? detail : undefined,
    );
  };
};

export const waitForReceipt = async (
  tx: ContractTransactionResponse,
): Promise<ContractTransactionReceipt> => {
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  if (!receipt) {
    throw new AppError('errors:contract.noReceipt');
  }
  return receipt;
};
