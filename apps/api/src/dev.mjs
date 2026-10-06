import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { watch } from 'node:fs';
const require = createRequire(import.meta.url);
let server;
let timer;
function compileAndStart() {
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], { stdio: 'inherit' });
  if (result.status !== 0) return;
  if (server) {
    const previous = server;
    server = undefined;
    previous.once('exit', () => { server = spawn(process.execPath, ['dist/main.js'], { stdio: 'inherit' }); });
    previous.kill();
  } else server = spawn(process.execPath, ['dist/main.js'], { stdio: 'inherit' });
}
compileAndStart();
watch(new URL('.', import.meta.url), { recursive: true }, (_event, filename) => {
  if (!filename?.endsWith('.ts')) return;
  clearTimeout(timer);
  timer = setTimeout(compileAndStart, 250);
});
process.on('SIGINT', () => { server?.kill(); process.exit(); });
process.on('SIGTERM', () => { server?.kill(); process.exit(); });
