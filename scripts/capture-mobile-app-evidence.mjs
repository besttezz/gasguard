import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const manifestPath = resolve(root, 'docs/ui-review/mobile-app/capture-manifest.json');
const output = resolve(root, 'docs/ui-review/mobile-app/screenshots');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

await mkdir(output, { recursive: true });
for (const item of manifest) {
  const [width, height] = item.viewport.split('×').map(Number);
  const params = new URLSearchParams({ capture: '1', role: item.role, page: item.page, scenario: item.scenario, ...(item.overlay ? { overlay: item.overlay } : {}) });
  const url = `http://localhost:5567/?${params}`;
  const destination = resolve(output, item.file);
  const result = await new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--use-gl=swiftshader', '--use-angle=swiftshader-webgl', '--disable-features=Vulkan', '--no-first-run', '--no-default-browser-check',
      `--window-size=${width},${height}`, '--virtual-time-budget=1800',
      `--screenshot=${destination}`, url
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', rejectCapture);
    child.once('exit', code => code === 0 ? resolveCapture() : rejectCapture(new Error(stderr || `Chrome exited ${code}`)));
  });
  void result;
}
console.log(`Captured ${manifest.length} mobile application review images to ${output}`);
