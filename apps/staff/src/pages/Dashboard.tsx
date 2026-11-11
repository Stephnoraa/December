import { Loading, PageHeader } from '../components/ui';
import { SetupChecklist, useChecklist } from './Checklist';

export default function Dashboard() {
  const checklist = useChecklist();
  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" />
      {checklist.isLoading ? (
        <Loading />
      ) : (
        checklist.data && <SetupChecklist checklist={checklist.data} />
      )}
    </div>
  );
}
