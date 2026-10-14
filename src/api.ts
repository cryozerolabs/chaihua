import type { CanvasItem, Job, Operation, PlacedLayer, Point, Project, ProjectPatch } from '../shared/types';

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? '本地服务暂时不可用，请稍后重试。');
  return body as T;
}
export const api = {
  project: () => request<Project>('/api/project'),
  save: (patch: ProjectPatch) => request<Project>('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  jobs: () => request<Job[]>('/api/jobs'),
  start: (operation: Operation, body: unknown) => request<Job>(`/api/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  retry: (id: string) => request<Job>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  upload: (file: File, point: Point) => {
    const data = new FormData(); data.append('image', file); data.append('x', String(point.x)); data.append('y', String(point.y));
    return request<CanvasItem>('/api/upload', { method: 'POST', body: data });
  },
};

async function download(url:string,filename:string) {
  const response = await fetch(url);
  if (!response.ok) { const body = await response.json().catch(()=>null); throw new Error(body?.error ?? '导出失败，请重试。'); }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = objectUrl; link.download = filename.replace(/[\\/:*?"<>|]/g, '-');
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
}
export const downloadItem=(item:CanvasItem,format:'png'|'psd'='png')=>download(`/api/export/${item.id}?format=${format}`,`${item.title}-${item.width}x${item.height}.${format}`);
export const downloadLayer=(item:CanvasItem,layer:PlacedLayer)=>download(`/api/export/${item.id}/layers/${layer.id}`,`${layer.name}-${layer.asset.width}x${layer.asset.height}.png`);
