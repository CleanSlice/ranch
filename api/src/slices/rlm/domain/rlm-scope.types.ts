// Embedded verbatim in the RLM job's JWT (see AuthService.issueRlmJobToken).
// Stateless by design: the guard re-validates every internal-context request
// against this claim instead of looking up a server-side job registry, so
// it stays correct across API replicas.
export interface IRlmJobScope {
  jobId: string;
  agentId: string;
  knowledgeIds: string[];
  sourceIds: string[];
  // Only agent-file paths starting with this prefix are readable by the job
  // (e.g. 'workspace/'). Never 'memory/' or 'sessions/'.
  filePrefix: string;
}
