import { AppShell } from '../components/shell/AppShell.js';
import { WorkspaceScreen } from './workspace/WorkspaceScreen.js';
import { useHealthReport } from '../hooks/use-health-report.js';
import { useHealthNotifications } from '../hooks/use-health-notifications.js';

interface MainProps {
  onOpenSettings: () => void;
}

export function Main({ onOpenSettings }: MainProps): React.ReactElement {
  const { data: healthReport } = useHealthReport('personal');
  useHealthNotifications(healthReport);

  return (
    <AppShell onOpenSettings={onOpenSettings} {...(healthReport ? { healthSeverity: healthReport.worst } : {})}>
      <WorkspaceScreen />
    </AppShell>
  );
}
