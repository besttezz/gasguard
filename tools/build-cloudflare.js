'use strict';

const { buildStatic } = require('./build-static.js');

function buildCloudflare({ env = process.env } = {}) {
  const output = buildStatic({ env, isCloudflare: true });
  console.log(`Cloudflare Pages static build ready: ${output}`);
  return output;
}

if (require.main === module) {
  buildCloudflare();
}

module.exports = Object.freeze({ buildCloudflare });
