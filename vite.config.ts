import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  preview: {
    allowedHosts: [
      'projectmanager.lithovox.nl',
      'localhost'
    ]
  },
  server: {
    allowedHosts: [
      'projectmanager.lithovox.nl',
      'localhost'
    ]
  }
});
