import { handleTelemetry, methodNotAllowed } from '../../../../cloud/device-api.mjs';

export const onRequestPost = ({ request, env }) => handleTelemetry(request, env);
export const onRequest = () => methodNotAllowed('POST');
