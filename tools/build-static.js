'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(projectRoot, 'dist');
const staticEntries = Object.freeze(['index.html', 'assets', 'css', 'js']);

function isJwtServiceRole(token) {
  if (typeof token !== 'string') return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(jsonPayload);
    return payload && payload.role === 'service_role';
  } catch (_) {
    return false;
  }
}

function validateKey(key) {
  if (!key) return;
  if (/service_role|^sb_secret_/i.test(key) || isJwtServiceRole(key)) {
    throw new Error('Refusing to publish a Supabase secret/service_role key');
  }
}

function publicAuthConfig(env = process.env, isCloudflare = false) {
  const url = String(env.GASGUARD_SUPABASE_URL || '').trim();
  const key = String(env.GASGUARD_SUPABASE_ANON_KEY || '').trim();

  if (isCloudflare) {
    if (!url || !/^https:\/\/[a-z0-9\.\-]+/i.test(url)) {
      throw new Error('GASGUARD_SUPABASE_URL is missing or invalid');
    }
    if (!key) {
      throw new Error('GASGUARD_SUPABASE_ANON_KEY is missing or invalid');
    }
  }

  validateKey(key);

  return `(function(){'use strict';window.GASGUARD_AUTH_CONFIG=Object.freeze({SUPABASE_URL:${JSON.stringify(url)},SUPABASE_ANON_KEY:${JSON.stringify(key)}});}());\n`;
}

function emptyDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const file of fs.readdirSync(dirPath)) {
    const curPath = path.join(dirPath, file);
    if (fs.lstatSync(curPath).isDirectory()) {
      emptyDirSync(curPath);
      try { fs.rmdirSync(curPath); } catch (_) {}
    } else {
      try { fs.unlinkSync(curPath); } catch (_) {}
    }
  }
}

function copyTree(source, destination) {
  const stats = fs.statSync(source);
  if (!stats.isDirectory()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, fs.readFileSync(source));
    return;
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry));
}

function buildStatic({ env = process.env, isCloudflare = false } = {}) {
  // Deterministic build: Remove previous dist contents reliably across all environments
  if (fs.existsSync(outputRoot)) {
    emptyDirSync(outputRoot);
  } else {
    fs.mkdirSync(outputRoot, { recursive: true });
  }

  for (const entry of staticEntries) copyTree(path.join(projectRoot, entry), path.join(outputRoot, entry));

  // Copy _headers file if present in project root
  const headersFile = path.join(projectRoot, '_headers');
  if (fs.existsSync(headersFile)) {
    fs.copyFileSync(headersFile, path.join(outputRoot, '_headers'));
  }

  fs.writeFileSync(path.join(outputRoot, 'js', 'auth-config.js'), publicAuthConfig(env, isCloudflare), 'utf8');
  return outputRoot;
}

if (require.main === module) console.log(`Static frontend ready: ${buildStatic()}`);
module.exports = Object.freeze({ buildStatic, publicAuthConfig, outputRoot, staticEntries, isJwtServiceRole });
