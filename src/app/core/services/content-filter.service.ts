import { Injectable } from '@angular/core';
import { Filter } from 'bad-words';

@Injectable({ providedIn: 'root' })
export class ContentFilterService {
  private filter = new Filter();

  /** Returns true if text contains no profanity */
  isClean(text: string): boolean {
    if (!text?.trim()) return true;
    return !this.filter.isProfane(text);
  }

  /** Replaces profanity with asterisks */
  clean(text: string): string {
    if (!text?.trim()) return text;
    return this.filter.clean(text);
  }
}
