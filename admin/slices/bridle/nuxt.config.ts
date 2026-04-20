import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: { '#bridle': currentDir },
  imports: {
    dirs: [`${currentDir}/stores`],
  },
});
