export function workspaceOf(knowledgeId: string): string {
  return `knowledge_${knowledgeId.replace(/-/g, '')}`;
}
