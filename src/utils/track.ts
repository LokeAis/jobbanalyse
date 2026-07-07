export type AnalyticsEvent =
  | 'test_started'
  | 'test_completed'
  | 'job_analysis_run'
  | 'interview_started'
  | 'client_error';

/** Fire-and-forget aggregate event ping. Never throws, never blocks the UI. */
export function track(event: AnalyticsEvent): void {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

/**
 * Registrer én aggregert `client_error`-telling hvis brukeren treffer en ukjent
 * JS-feil. Kun ETT ping per sideinnlasting — en ødelagt render-løkke skal ikke
 * spamme endepunktet, og vi sender ingen feiltekst/persondata (kun at det skjedde).
 */
let clientErrorReported = false;
export function installErrorTracking(): void {
  const report = () => {
    if (clientErrorReported) return;
    clientErrorReported = true;
    track('client_error');
  };
  window.addEventListener('error', report);
  window.addEventListener('unhandledrejection', report);
}
