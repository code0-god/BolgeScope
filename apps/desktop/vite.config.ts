import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function buildCommit(): string {
  try {
    const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();
    return `${git('rev-parse --short HEAD')}${git('status --porcelain') ? '-dirty' : ''}`;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15' },
});
