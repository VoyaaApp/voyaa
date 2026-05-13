export function formatCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.floor(n / 1000) + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Convert a Cloudinary video URL to a thumbnail image URL */
export function getThumbUrl(url: string): string {
  if (!url) return '';
  return url
    .replace('/video/upload/', '/video/upload/so_0,w_400,h_500,c_fill,q_auto,f_auto/')
    .replace(/\.[^.]+$/, '.jpg');
}
