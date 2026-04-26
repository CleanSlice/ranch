import { FilesService } from '#api/data';

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

export const useAgentFileStore = defineStore('agentFile', () => {
  const nodes = ref<IFileNode[]>([]);

  async function fetchList(agentId: string) {
    const res = await FilesService.fileControllerList({ path: { agentId } });
    const env = res.data as ApiEnvelope<IFileNode[]> | undefined;
    nodes.value = env?.data ?? [];
    return nodes.value;
  }

  async function fetchContent(agentId: string, path: string): Promise<IFileContent> {
    const res = await FilesService.fileControllerRead({
      path: { agentId },
      query: { path },
    });
    const env = res.data as ApiEnvelope<IFileContent>;
    return env.data;
  }

  async function save(
    agentId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    const res = await FilesService.fileControllerSave({
      path: { agentId },
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

  return { nodes, fetchList, fetchContent, save };
});
