import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: { '#bridle': currentDir },
  // The chat markdown rules are global and needed wherever a message is
  // rendered, the chat history included, so the slice loads them itself
  // instead of a component carrying a copy (CLEAN-137).
  css: [`${currentDir}/assets/chat-md.css`],
  imports: {
    dirs: [`${currentDir}/stores`],
  },
});
