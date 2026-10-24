import { mappls } from 'mappls-web-maps';

export const mapplsSdk = new mappls();

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initializes the Mappls Web Maps SDK.
 * Includes a timeout so the UI never hangs on a blank screen if MapmyIndia fails/401s.
 */
export function initMappls(timeoutMs = 2500): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  const key = import.meta.env.VITE_MAPPLS_KEY;
  if (!key) {
    return Promise.reject(new Error('VITE_MAPPLS_KEY is not set in frontend/.env'));
  }

  const loadPromise = new Promise<void>((resolve, reject) => {
    try {
      mapplsSdk.initialize(
        key,
        {
          map: true,
          version: '3.0',
        },
        () => {
          initialized = true;
          resolve();
        }
      );
    } catch (err: any) {
      initPromise = null;
      reject(err);
    }
  });

  const timerPromise = new Promise<void>((_, reject) => {
    setTimeout(() => {
      if (!initialized) {
        initPromise = null;
        reject(new Error(`Mappls SDK load timed out after ${timeoutMs}ms (key invalid, expired, or network blocked)`));
      }
    }, timeoutMs);
  });

  initPromise = Promise.race([loadPromise, timerPromise]);
  return initPromise;
}

export default mapplsSdk;
