import { TaskViewScreen } from '@/features/tasks/components/TaskViewScreen'
import { CaptureQueue } from '../components/CaptureQueue'

/**
 * The Inbox: captures not yet decided (M18.3), above tasks not yet filed.
 * One page for everything that has come in and not found its place.
 */
export function InboxView() {
  return <TaskViewScreen view="inbox" lead={<CaptureQueue />} />
}
