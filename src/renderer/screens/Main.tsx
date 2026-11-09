import { AppShell } from '../components/shell/AppShell.js';
import { WorkspaceScreen } from './workspace/WorkspaceScreen.js';
import { useHealthReport } from '../hooks/use-health-report.js';
import { useHealthNotifications } from '../hooks/use-health-notifications.js';

export function Main(): React.ReactElement {
  const { data: healthReport } = useHealthReport('personal');
  useHealthNotifications(healthReport);

  return (
    <AppShell {...(healthReport ? { healthSeverity: healthReport.worst } : {})}>
      <WorkspaceScreen />
    </AppShell>
  );
}
