const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Asia/Kolkata',
});

export const formatDateTime = (iso: string | null): string =>
  iso ? `${dateTime.format(new Date(iso))} IST` : '—';

export const formatCoord = (n: number | null): string => (n === null ? '—' : n.toFixed(6));
