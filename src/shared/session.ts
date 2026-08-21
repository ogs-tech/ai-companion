export type SessionStatus = 'running' | 'exited';

export interface SessionSnapshot {
  entityUrn: string;
  cwd: string;
  status: SessionStatus;
}
