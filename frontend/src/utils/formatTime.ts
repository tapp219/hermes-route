const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatTime(timestamp: number): string {
  return formatter.format(timestamp);
}
