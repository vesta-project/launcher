import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';

export function BrowsePage() {
  return (
    <Board>
      <EmptyState
        icon="icons/content/search"
        title="Browse is coming next"
        description="Search Modrinth and CurseForge, then install straight into an instance."
      />
    </Board>
  );
}
