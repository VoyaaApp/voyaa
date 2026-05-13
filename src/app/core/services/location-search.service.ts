import { Injectable } from '@angular/core';
import { COUNTRY_COORDS } from '../../shared/data/geo';

export interface LocationSuggestion {
  display: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  type: 'country' | 'city' | 'town';
}

@Injectable({ providedIn: 'root' })
export class LocationSearchService {
  private searchTimer: any = null;
  private abortController: AbortController | null = null;
  private countries = Object.keys(COUNTRY_COORDS);

  search(query: string, callback: (results: LocationSuggestion[], loading: boolean) => void): void {
    clearTimeout(this.searchTimer);
    this.abortController?.abort();

    const q = query.trim();
    if (q.length < 2) {
      callback([], false);
      return;
    }

    // Instant local country matches
    const localMatches = this.getLocalMatches(q);
    if (localMatches.length > 0) {
      callback(localMatches, true);
    } else {
      callback([], true);
    }

    // Debounced API search
    this.searchTimer = setTimeout(() => this.fetchResults(q, localMatches, callback), 300);
  }

  cancel(): void {
    clearTimeout(this.searchTimer);
    this.abortController?.abort();
  }

  private getLocalMatches(query: string): LocationSuggestion[] {
    const q = query.toLowerCase();
    const results: LocationSuggestion[] = [];

    for (const country of this.countries) {
      const lower = country.toLowerCase();
      if (lower === q) {
        results.unshift({
          display: country,
          city: '',
          country,
          lat: COUNTRY_COORDS[country][0],
          lon: COUNTRY_COORDS[country][1],
          type: 'country',
        });
      } else if (lower.startsWith(q)) {
        results.push({
          display: country,
          city: '',
          country,
          lat: COUNTRY_COORDS[country][0],
          lon: COUNTRY_COORDS[country][1],
          type: 'country',
        });
      }
    }

    return results.slice(0, 3);
  }

  private async fetchResults(
    query: string,
    localMatches: LocationSuggestion[],
    callback: (results: LocationSuggestion[], loading: boolean) => void,
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      const params = new URLSearchParams({
        q: query,
        limit: '10',
        lang: 'en',
      });
      params.append('layer', 'city');
      params.append('layer', 'county');
      params.append('layer', 'state');
      params.append('layer', 'country');

      const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
        signal: this.abortController.signal,
      });
      const data = await res.json();

      const apiResults: LocationSuggestion[] = [];
      const seen = new Set<string>();

      // Add local matches first
      for (const m of localMatches) {
        seen.add(m.display.toLowerCase());
        apiResults.push(m);
      }

      for (const feature of data.features || []) {
        const props = feature.properties || {};
        const coords = feature.geometry?.coordinates;
        if (!coords || !props.country) continue;

        const city = props.name || '';
        const country = props.country || '';
        const type = props.type;

        if (!city && !country) continue;

        let display: string;
        let resultCity: string;
        let resultType: 'city' | 'town' | 'country';

        if (type === 'country' || (!city || city === country)) {
          display = country;
          resultCity = '';
          resultType = 'country';
        } else {
          const state = props.state || '';
          if (type === 'state' && state) {
            display = `${state}, ${country}`;
            resultCity = state;
          } else {
            display = `${city}, ${country}`;
            resultCity = city;
          }
          resultType = type === 'city' ? 'city' : 'town';
        }

        const key = display.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        apiResults.push({
          display,
          city: resultCity,
          country,
          lat: coords[1],
          lon: coords[0],
          type: resultType,
        });
      }

      const scored = this.scoreResults(apiResults, query);
      callback(scored.slice(0, 8), false);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      callback(localMatches, false);
    }
  }

  private scoreResults(results: LocationSuggestion[], query: string): LocationSuggestion[] {
    const q = query.toLowerCase();

    return results.sort((a, b) => {
      const scoreA = this.getScore(a, q);
      const scoreB = this.getScore(b, q);
      return scoreB - scoreA;
    });
  }

  private getScore(item: LocationSuggestion, query: string): number {
    let score = 0;
    const display = item.display.toLowerCase();
    const city = item.city.toLowerCase();
    const country = item.country.toLowerCase();

    if (display === query) score += 100;
    else if (city === query || country === query) score += 90;
    else if (display.startsWith(query) || city.startsWith(query) || country.startsWith(query)) score += 70;
    else if (display.includes(query)) score += 40;

    if (item.type === 'city') score += 10;
    else if (item.type === 'town') score += 5;

    if (this.countries.includes(item.country)) score += 8;

    return score;
  }
}
