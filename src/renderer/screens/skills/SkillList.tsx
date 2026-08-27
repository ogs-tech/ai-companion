import { CustomizationListScreen } from '../../components/CustomizationListScreen.js';

export function SkillList(): React.ReactElement {
  return (
    <CustomizationListScreen
      entityType="skill"
      title="Skills"
      singular="skill"
      gender="f"
      listMethod="skill.list"
      deleteMethod="skill.delete"
      subtitle="Pessoais — aparecem em todos os workspaces. Skills por projeto ainda não são suportadas."
    />
  );
}
