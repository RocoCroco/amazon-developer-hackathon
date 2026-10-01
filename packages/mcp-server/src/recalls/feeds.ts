import { fetchCpscRecalls, type FetchLike } from './cpsc.js';
import { fetchOpenFdaRecalls, type OpenFdaKind } from './openfda.js';
import type { Feed } from './sync.js';

const compact = (isoDate: string) => isoDate.replaceAll('-', '');

/** CPSC: everything published since the date (the API has no upper bound). */
export function cpscFeed(fetchFn?: FetchLike): Feed {
  return { id: 'cpsc', fetchSince: (since) => fetchCpscRecalls(since, fetchFn) };
}

/** openFDA food or drug enforcement reports with report_date in the window. */
export function openFdaFeed(kind: OpenFdaKind, fetchFn?: FetchLike): Feed {
  return {
    id: kind === 'food' ? 'fda-food' : 'fda-drug',
    fetchSince: (since, until) =>
      fetchOpenFdaRecalls(kind, compact(since), compact(until), fetchFn),
  };
}
