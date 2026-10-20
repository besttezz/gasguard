import { handleSummary } from '../../../../cloud/site-api.mjs';
import { methodNotAllowed } from '../../../../cloud/device-api.mjs';

export const onRequestPost = ({ request, env }) => handleSummary(request, env);
export const onRequest = () => methodNotAllowed('POST');
