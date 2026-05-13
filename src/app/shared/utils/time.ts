export function timeAgo(value: any): string {
  if (!value) return '';
  const now = Date.now();
  const then = typeof value === 'string'
    ? new Date(value).getTime()
    : value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : 0);
  if (!then) return '';
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;

  const date = new Date(then);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
