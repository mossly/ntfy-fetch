import fs from 'fs';
import path from 'path';

const srcDir = path.resolve('webui', 'dist');
const destDir = path.resolve('dist', 'ui');

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

if (!fs.existsSync(srcDir)) {
  console.error(`UI build directory not found: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
copyRecursive(srcDir, destDir);
console.log(`Copied UI build from ${srcDir} to ${destDir}`);

