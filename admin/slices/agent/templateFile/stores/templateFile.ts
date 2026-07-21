import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IFileContent,
  IFileNode,
  TemplateFileService,
} from '#templateFile/domain';

// Re-export the domain types for consumers importing from
// `#templateFile/stores/templateFile`.
export type { IFileContent, IFileNode } from '#templateFile/domain';

const getService = createServiceGetter<TemplateFileService>(
  '$templateFileService',
);

export const useTemplateFileStore = defineStore('templateFile', () => {
  const nodes = ref<IFileNode[]>([]);

  async function fetchList(templateId: string) {
    nodes.value = await getService().list(templateId);
    return nodes.value;
  }

  function fetchContent(
    templateId: string,
    path: string,
  ): Promise<IFileContent> {
    return getService().read(templateId, path);
  }

  async function save(
    templateId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    const updated = await getService().save(templateId, path, content);
    nodes.value = nodes.value.map((n) =>
      n.path === path
        ? { path: n.path, size: updated.size, updatedAt: updated.updatedAt }
        : n,
    );
    return updated;
  }

  async function uploadFolder(
    templateId: string,
    files: File[],
  ): Promise<IFileNode[]> {
    nodes.value = await getService().upload(templateId, files);
    return nodes.value;
  }

  return { nodes, fetchList, fetchContent, save, uploadFolder };
});
