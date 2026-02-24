// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kiddos-events.hr',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [sitemap()],
});
