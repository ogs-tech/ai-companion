import { CustomizationListScreen } from '../../components/CustomizationListScreen.js';

export function AgentList(): React.ReactElement {
  return (
    <CustomizationListScreen
      entityType="agent"
      title="Agents"
      singular="agent"
      gender="m"
      listMethod="agent.list"
      deleteMethod="agent.delete"
      subtitle="Pessoais — aparecem em todos os workspaces. Agents por projeto ainda não são suportados."
    />
  );
}
