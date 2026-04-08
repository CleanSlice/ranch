import * as fs from 'fs';
import * as path from 'path';

export const registerSlices = (): string[] => {
  const settings = {
    specialSlices: ['./slices/setup', './slices/common'],
  };

  const slices = fs.readdirSync('./slices').filter((entry) => {
    const fullPath = path.join('./slices', entry);
    return fs.statSync(fullPath).isDirectory();
  });

  if (!slices.length) return [];

  const result: string[] = [];

  const collectSlices = (slicePath: string) => {
    if (fs.existsSync(`${slicePath}/nuxt.config.ts`)) {
      if (!result.includes(slicePath)) {
        result.push(slicePath);
      }
    } else {
      const subPaths = fs.readdirSync(slicePath).filter((entry) => {
        const fullPath = `${slicePath}/${entry}`;
        return fs.statSync(fullPath).isDirectory();
      });
      for (const subPath of subPaths) {
        collectSlices(`${slicePath}/${subPath}`);
      }
    }
  };

  for (const specialSlice of settings.specialSlices) {
    collectSlices(specialSlice);
  }

  for (const slice of slices) {
    const slicePath = `./slices/${slice}`;
    collectSlices(slicePath);
  }

  return result;
};
