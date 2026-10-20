import { handleTelemetry, methodNotAllowed } from '../../../../cloud/device-api.mjs';

export const onRequestPost = context => handleTelemetry(context.request, context.env, fetch, { waitUntil: promise => context.waitUntil(promise) });
export const onRequest = () => methodNotAllowed('POST');
