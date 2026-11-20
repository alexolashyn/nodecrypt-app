import { useKeyring } from '@/context/keyring';
import { Unlock } from './Unlock';

export function UnlockPrompt() {
  const { cancelUnlock } = useKeyring();

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
    >
      <Unlock onCancel={cancelUnlock} />
    </div>
  );
}
