import { handleConfig } from '../../../cloud/site-api.mjs';

export const onRequestGet = ({ env }) => handleConfig(env);
