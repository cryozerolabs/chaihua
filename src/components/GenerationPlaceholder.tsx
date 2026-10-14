import { Sparkles } from 'lucide-react';
import type { Job, Viewport } from '../../shared/types';

export function GenerationPlaceholder({ job, viewport }: { job: Job; viewport: Viewport }) {
  const label = job.status === 'queued' ? '等待生成' : '正在生成图片';
  return <div className="generation-placeholder" data-job-id={job.id} role="status" aria-label={label}
    style={{ left: viewport.x + (job.position?.x ?? 100) * viewport.scale,
      top: viewport.y + (job.position?.y ?? 100) * viewport.scale, transform: `scale(${viewport.scale})` }}>
    <div className="generation-glow" aria-hidden="true" />
    <div className="generation-sheen" aria-hidden="true" />
    <svg className="generation-border" viewBox="0 0 280 220" aria-hidden="true">
      <rect x="1" y="1" width="278" height="218" rx="14" />
    </svg>
    <div className="generation-content">
      <span className="generation-icon" aria-hidden="true"><Sparkles size={22} /></span>
      <strong>{label}<span className="generation-dots" aria-hidden="true"><i /><i /><i /></span></strong>
      <span>完成后会自动放到画布上</span>
    </div>
  </div>;
}
