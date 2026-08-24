import { useState } from 'react';
import { AppShell } from '../components/shell/AppShell.js';
import { defaultNav, type Nav } from '../components/shell/nav.js';
import { WorkspaceScreen } from './workspace/WorkspaceScreen.js';
import { SkillList } from './skills/SkillList.js';
import { AgentList } from './agents/AgentList.js';
import { HookList } from './hooks/HookList.js';
import { InstructionsScreen } from './instructions/InstructionsScreen.js';
import { McpList } from './mcps/McpList.js';
import { MarketplaceList } from './marketplaces/MarketplaceList.js';
import { PluginList } from './plugins/PluginList.js';
import { StarterPackScreen } from './starter-pack/StarterPackScreen.js';
import { HealthScreen } from './health/HealthScreen.js';
import { useHealthReport } from '../hooks/use-health-report.js';
import { useHealthNotifications } from '../hooks/use-health-notifications.js';

interface MainProps {
  onOpenSettings: () => void;
}

function screenFor(nav: Nav, navigate: (n: Nav) => void): React.ReactElement {
  switch (nav.area) {
    case 'inicio':
      return <StarterPackScreen onNavigate={navigate} />;
    case 'workspace':
      return <WorkspaceScreen />;
    case 'diagnostico':
      return <HealthScreen />;
    case 'plugins':
      return nav.sub === 'plugins' ? <PluginList scope="personal" /> : <MarketplaceList />;
    case 'biblioteca':
      switch (nav.sub) {
        case 'skills':
          return <SkillList />;
        case 'agents':
          return <AgentList />;
        case 'hooks':
          return <HookList />;
        case 'instructions':
          return <InstructionsScreen />;
        case 'mcps':
          return <McpList />;
      }
  }
}

export function Main({ onOpenSettings }: MainProps): React.ReactElement {
  const [nav, setNav] = useState<Nav>(defaultNav);
  const { data: healthReport } = useHealthReport('personal');
  useHealthNotifications(healthReport);

  return (
    <AppShell
      nav={nav}
      onNavigate={setNav}
      onOpenSettings={onOpenSettings}
      {...(healthReport ? { healthSeverity: healthReport.worst } : {})}
    >
      {screenFor(nav, setNav)}
    </AppShell>
  );
}
