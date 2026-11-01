import { handleExplain } from '../../../../cloud/site-api.mjs';
import { methodNotAllowed } from '../../../../cloud/device-api.mjs';

export const onRequestPost = ({ request, env }) => handleExplain(request, env);
export const onRequest = () => methodNotAllowed('POST');
