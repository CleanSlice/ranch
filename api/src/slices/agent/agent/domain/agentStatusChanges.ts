import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { AgentStatusTypes } from './agent.types';

export interface IAgentStatusChange {
  agentId: string;
  // 'deleted' is not a status a row can hold — it is the row going away.
  status: AgentStatusTypes | 'deleted';
  reason: string | null;
  at: Date;
}

/**
 * Every real change of an agent's status, announced once.
 *
 * Five call sites write a status and only one of them told anyone
 * (AgentStatusService.statusWrites$), so a listener there missed a workflow
 * that failed on GET, a deploy that could not be submitted and every stop.
 * The gateway is the one place all of them pass through, and it emits here
 * only when the row's status actually changed — with several API replicas
 * both may write 'failed', and exactly one of them sees a change (CLEAN-139).
 *
 * In-process: a listener hears the transitions this replica wrote. That is
 * enough for anything that turns a transition into a database row, because
 * each transition is written, and so announced, by exactly one replica.
 */
@Injectable()
export class AgentStatusChanges {
  private readonly subject = new Subject<IAgentStatusChange>();

  emit(change: IAgentStatusChange): void {
    this.subject.next(change);
  }

  changes$(): Observable<IAgentStatusChange> {
    return this.subject.asObservable();
  }
}
