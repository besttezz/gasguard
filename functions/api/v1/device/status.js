import { handleStatus, methodNotAllowed } from '../../../../cloud/device-api.mjs';

export const onRequestGet = ({ request, env }) => handleStatus(request, env);
export const onRequest = () => methodNotAllowed('GET');
