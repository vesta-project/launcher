import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';

export function CreatePage() {
  return (
    <Board>
      <EmptyState
        icon="icons/actions/add"
        title="New instance"
        description="Pick a Minecraft version and loader, or import a modpack."
      />
    </Board>
  );
}
