'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(projectRoot, 'dist');
const staticEntries = Object.freeze(['index.html', 'assets', 'css', 'js']);

function publicAuthConfig(env = process.env) {
  const url = String(env.GASGUARD_SUPABASE_URL || '').trim();
  const key = String(env.GASGUARD_SUPABASE_ANON_KEY || '').trim();
  if (/service_role|^sb_secret_/i.test(key)) throw new Error('Refusing to publish a Supabase secret/service_role key');
  return `(function(){'use strict';window.GASGUARD_AUTH_CONFIG=Object.freeze({SUPABASE_URL:${JSON.stringify(url)},SUPABASE_ANON_KEY:${JSON.stringify(key)}});}());\n`;
}

function copyTree(source, destination) {
  const stats = fs.statSync(source);
  if (!stats.isDirectory()) {
    fs.mkdirSync(path.dirname(destination), { recursive:true });
    fs.writeFileSync(destination, fs.readFileSync(source));
    return;
  }
  fs.mkdirSync(destination, { recursive:true });
  for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry));
}

function buildStatic({ env = process.env } = {}) {
  fs.mkdirSync(outputRoot, { recursive:true });
  for (const entry of staticEntries) copyTree(path.join(projectRoot, entry), path.join(outputRoot, entry));
  fs.writeFileSync(path.join(outputRoot, 'js', 'auth-config.js'), publicAuthConfig(env), 'utf8');
  return outputRoot;
}

if (require.main === module) console.log(`Static frontend ready: ${buildStatic()}`);
module.exports = Object.freeze({ buildStatic, publicAuthConfig, outputRoot, staticEntries });
