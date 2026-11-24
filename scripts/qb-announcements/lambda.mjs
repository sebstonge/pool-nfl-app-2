import { createScheduledObservationHandler } from './scheduled.mjs';

const path = '/api/cron/qb-observation';

export function lambdaAdapter(observe) {
  return async event => {
    if (event.rawPath !== path) return { statusCode: 404, body: '' };
    const method = event.requestContext?.http?.method;
    if (!method) return { statusCode: 400, body: '' };
    const body = method === 'POST' && typeof event.body === 'string'
      ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : undefined;
    const response = await observe(new Request(`https://observer.invalid${path}`, {
      method, headers: event.headers, body,
    }));
    return { statusCode: response.status, headers: Object.fromEntries(response.headers),
      body: await response.text(), isBase64Encoded: false };
  };
}

export const handler = createScheduledObservationHandler();
