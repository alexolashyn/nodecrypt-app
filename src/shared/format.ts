const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const formatBytes = (value: number | bigint): string => {
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 100 ? 0 : 1;
  return `${size.toFixed(digits)} ${UNITS[unit]}`;
};

export const formatDate = (unixSeconds: number, locale: string): string => {
  return new Date(unixSeconds * 1000).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};
