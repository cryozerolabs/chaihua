import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { EMPTY_PROJECT, type Asset, type Job, type Project, type ProjectPatch } from '../shared/types';

export class Store {
  private project: Project = structuredClone(EMPTY_PROJECT);
  private writes: Promise<unknown> = Promise.resolve();
  readonly jobs = new Map<string, Job>();
  constructor(readonly directory: string) {}
  get assetDirectory() { return path.join(this.directory, 'assets'); }
  async initialize() {
    await mkdir(this.assetDirectory, { recursive: true });
    await mkdir(path.join(this.directory, 'jobs'), { recursive: true });
    try {
      const data = JSON.parse(await readFile(path.join(this.directory, 'project.json'), 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.items)) throw new Error('项目文件格式不正确');
      this.project = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const filename of await readdir(path.join(this.directory, 'jobs'))) {
      if (!filename.endsWith('.json')) continue;
      const job: Job = JSON.parse(await readFile(path.join(this.directory, 'jobs', filename), 'utf8'));
      this.jobs.set(job.id, job);
      if (job.status === 'running' || job.status === 'queued') {
        await this.updateJob(job.id, { status: 'failed', stage: '任务已中断', error: '本地服务已重启，点击重试即可继续。' });
      }
    }
  }
  getProject(): Project { return structuredClone(this.project); }
  getItem(id: string) { return this.project.items.find(item => item.id === id); }
  patchProject(patch: ProjectPatch): Promise<Project> {
    const task = this.writes.then(async () => {
      const deletions = new Set(patch.deleteIds ?? []);
      const upserts = new Map((patch.items ?? []).map(item => [item.id, item]));
      const next = this.project.items.filter(item => !deletions.has(item.id)).map(item => {
        const replacement = upserts.get(item.id);
        upserts.delete(item.id);
        return replacement ?? item;
      });
      next.push(...upserts.values());
      const project: Project = { version: 1, items: next, viewport: patch.viewport ?? this.project.viewport };
      await this.atomicWrite(path.join(this.directory, 'project.json'), project);
      this.project = project;
      return this.getProject();
    });
    this.writes = task.catch(() => undefined);
    return task;
  }
  async saveAsset(buffer: Buffer): Promise<Asset> {
    const id = randomUUID();
    const result = await sharp(buffer, { limitInputPixels: 60_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
    await writeFile(path.join(this.assetDirectory, `${id}.png`), result.data);
    return { id, url: `/api/assets/${id}.png`, width: result.info.width, height: result.info.height };
  }
  readAsset(asset: Asset): Promise<Buffer> {
    if (!/^[a-f0-9-]{36}$/.test(asset.id)) throw new Error('素材 ID 不正确');
    return readFile(path.join(this.assetDirectory, `${asset.id}.png`));
  }
  async createJob(operation: Job['operation'], request: Record<string, unknown>): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = { id: randomUUID(), operation, sourceId: request.sourceId as string | undefined,
      position: request.position as Job['position'], status: 'queued', stage: '准备开始', request,
      createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job);
    await this.atomicWrite(path.join(this.directory, 'jobs', `${job.id}.json`), job);
    return structuredClone(job);
  }
  async updateJob(id: string, patch: Partial<Job>) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('任务不存在');
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    await this.atomicWrite(path.join(this.directory, 'jobs', `${id}.json`), job);
    return structuredClone(job);
  }
  private async atomicWrite(filename: string, data: unknown) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2));
    await rename(temporary, filename);
  }
}
