import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: { '#sessions': currentDir },
  imports: {
    dirs: [`${currentDir}/stores`],
  },
});
