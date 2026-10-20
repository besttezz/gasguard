import { handleLineWebhook } from '../../../../cloud/site-api.mjs';
import { methodNotAllowed } from '../../../../cloud/device-api.mjs';

export const onRequestPost = ({ request, env }) => handleLineWebhook(request, env);
export const onRequest = () => methodNotAllowed('POST');
