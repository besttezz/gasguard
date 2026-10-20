import { handleAdminUsers } from '../../../../cloud/site-api.mjs';

export const onRequest = ({ request, env }) => handleAdminUsers(request, env);
