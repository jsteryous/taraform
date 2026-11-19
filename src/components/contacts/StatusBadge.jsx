import { getStatusClass } from '../../lib/utils';
import { getStatusColor } from '../../lib/clientConfig';

// The status pill, colored from the workspace's own status list. Shared by the contact
// list and the contact page so the two can't show the same status in different colors.
export default function StatusBadge({ cfg, status }) {
  const color = getStatusColor(cfg, status);
  return (
    <span className={`status-badge ${getStatusClass(status)}`}
      style={{ background: `${color}22`, color, borderColor: `${color}44` }}>
      {status}
    </span>
  );
}
