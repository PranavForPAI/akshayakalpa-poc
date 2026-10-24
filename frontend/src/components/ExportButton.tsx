import { useMutation } from '@tanstack/react-query';
import { exportTripJson } from '../lib/export';

export function ExportButton({ tripId, disabled }: { tripId: string; disabled?: boolean }) {
  const mutation = useMutation({ mutationFn: () => exportTripJson(tripId) });

  return (
    <div className="export">
      <button className="primary" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'Exporting…' : 'Export all points (JSON)'}
      </button>
      {mutation.isError && <span className="error small">{mutation.error.message}</span>}
    </div>
  );
}
