export type SyncStatus = 'ok' | 'conflict' | 'error';

export interface SyncResultDetails {
  backupPath?: string;
  replacedTarget?: string;
  skipped?: 'no-linked-repos' | 'not-found' | 'unsupported-by-target';
  reason?: string;
  action?: 'overwritten';
}

export interface SyncResult {
  adapter: string;
  destination: string | null;
  status: SyncStatus;
  message?: string;
  details?: SyncResultDetails;
}
