import { environment } from '../../environments/environment';

export async function sharePost(title?: string): Promise<boolean> {
  const text = title || 'Check out this post on Voyaa';
  const url = environment.baseUrl;
  if (navigator.share) {
    try {
      await navigator.share({ title: text, text, url });
    } catch {}
    return false;
  } else {
    await navigator.clipboard.writeText(url);
    return true;
  }
}
