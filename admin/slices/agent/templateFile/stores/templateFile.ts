import { TemplateFilesService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface IFileNode {
  path: string;
  size: number;
  updatedAt: string;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
}

export const useTemplateFileStore = defineStore('templateFile', () => {
  const nodes = ref<IFileNode[]>([]);

  async function fetchList(templateId: string) {
    const res = await TemplateFilesService.templateFileControllerList({
      path: { id: templateId },
    });
    const env = res.data as ApiEnvelope<IFileNode[]> | undefined;
    nodes.value = env?.data ?? [];
    return nodes.value;
  }

  async function fetchContent(
    templateId: string,
    path: string,
  ): Promise<IFileContent> {
    const res = await TemplateFilesService.templateFileControllerRead({
      path: { id: templateId },
      query: { path },
    });
    const env = res.data as ApiEnvelope<IFileContent>;
    return env.data;
  }

  async function save(
    templateId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    const res = await TemplateFilesService.templateFileControllerSave({
      path: { id: templateId },
      query: { path },
      body: { content },
    });
    const env = res.data as ApiEnvelope<IFileContent>;
    const updated = env.data;
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
    const paths = files.map(
      (f) =>
        (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    );
    const res = await TemplateFilesService.templateFileControllerUpload({
      path: { id: templateId },
      body: { files, paths },
    });
    const env = res.data as ApiEnvelope<IFileNode[]> | undefined;
    nodes.value = env?.data ?? [];
    return nodes.value;
  }

  return { nodes, fetchList, fetchContent, save, uploadFolder };
});
