import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { readPsd } from 'ag-psd';
import '../server/exports';
import { Store } from '../server/store';

let child: ChildProcess, directory: string, base: string;
let sourceId: string,legacyJobId:string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ming-api-'));
  const stored=new Store(directory);await stored.initialize();
  const legacy=await stored.createJob('rearrange',{sourceId:randomUUID(),presetIds:['square']});
  legacyJobId=legacy.id;await stored.updateJob(legacy.id,{status:'failed',error:'old task'});
  const port = await new Promise<number>(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const address = server.address() as net.AddressInfo; server.close(() => resolve(address.port)); });
  });
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, API_KEY: '', DATA_DIR: directory, PORT: String(port) }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch { /* Wait for startup. */ }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('Test API did not start');
}, 10000);
afterAll(async () => {
  if (child) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('local API contracts', () => {
  it('uploads a real image and restores its dimensions in the project', async () => {
    const image = await sharp({ create: { width: 90, height: 60, channels: 4, background: '#6688aa' } }).png().toBuffer();
    const form = new FormData(); form.append('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'test.png'); form.append('x','150'); form.append('y','80');
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
    expect(response.status).toBe(201);
    const original = await response.json(); sourceId = original.id;
    expect(original).toMatchObject({ kind:'original',source:'uploaded',width:90,height:60,x:150,y:80 });
    const project = await (await fetch(`${base}/api/project`)).json();
    expect(project.items[0].id).toBe(sourceId);
    const exportResponse = await fetch(`${base}/api/export/${sourceId}`);
    const metadata = await sharp(Buffer.from(await exportResponse.arrayBuffer())).metadata();
    expect(metadata.width).toBe(90); expect(metadata.height).toBe(60);
  });
  it('rejects empty prompts, retired rearrangement and arbitrary asset URLs', async () => {
    const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
    expect((await post('/api/generate',{prompt:' ',position:{x:0,y:0}})).status).toBe(400);
    expect((await post('/api/rearrange',{sourceId,presetIds:['square']})).status).toBe(410);
    expect((await fetch(`${base}/api/jobs/${legacyJobId}`)).status).toBe(200);
    expect((await post(`/api/jobs/${legacyJobId}/retry`,{})).status).toBe(410);
    const project = await (await fetch(`${base}/api/project`)).json();
    const item = { ...project.items[0], asset:{...project.items[0].asset,url:'https://example.com/arbitrary.png'} };
    const response = await fetch(`${base}/api/project`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[item]})});
    expect(response.status).toBe(400);
  });
  it('exports PNG, independent PSD layers and the original material from groups and legacy boards',async()=>{
    const stored=new Store(directory);await stored.initialize();
    const asset=await stored.saveAsset(await sharp({create:{width:18,height:12,channels:4,background:{r:255,g:100,b:20,alpha:0.5}}}).png().toBuffer());
    const layer={id:randomUUID(),name:'透明素材',role:'subject',asset,x:-3,y:5,scale:2,z:1,visible:true,locked:false};
    const hidden={...layer,id:randomUUID(),name:'隐藏素材',visible:false,z:2};
    const group={id:randomUUID(),kind:'layer-group',title:'group',sourceId,width:90,height:60,x:500,y:-200,createdAt:'',backgroundDescription:'',expanded:false,layers:[hidden,layer]};
    const legacy={...group,id:randomUUID(),kind:'variant',presetId:'square',sourceId:group.id};
    const saved=await fetch(`${base}/api/project`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[group,legacy]})});
    expect(saved.status).toBe(200);
    for(const item of [group,legacy]) {
      const png=await fetch(`${base}/api/export/${item.id}`);
      expect((await sharp(Buffer.from(await png.arrayBuffer())).metadata())).toMatchObject({width:90,height:60});
      const response=await fetch(`${base}/api/export/${item.id}?format=psd`);
      expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('image/vnd.adobe.photoshop');
      const psd=readPsd(Buffer.from(await response.arrayBuffer()),{useImageData:true,skipThumbnail:true});
      expect(psd.children!.map(l=>l.name)).toEqual(['透明素材','隐藏素材']);
      expect(psd.children![0]).toMatchObject({left:-3,top:5,right:33,bottom:29});
      expect(psd.children![1].hidden).toBe(true);
      const material=await fetch(`${base}/api/export/${item.id}/layers/${layer.id}`);
      const metadata=await sharp(Buffer.from(await material.arrayBuffer())).metadata();
      expect(metadata).toMatchObject({width:18,height:12,hasAlpha:true});
    }
    expect((await fetch(`${base}/api/export/${sourceId}?format=psd`)).status).toBe(400);
    expect((await fetch(`${base}/api/export/${group.id}?format=jpg`)).status).toBe(400);
    expect((await fetch(`${base}/api/export/${group.id}/layers/${randomUUID()}`)).status).toBe(404);
  });
  it('exposes a failed model task as retryable without losing the source image', async () => {
    const response = await fetch(`${base}/api/decompose`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId})});
    expect(response.status).toBe(202); const job = await response.json();expect(job.request.mode).toBe('auto');
    let current = job;
    for(let i=0;i<50 && current.status!=='failed';i++) {
      await new Promise(resolve=>setTimeout(resolve,30));
      current = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
    }
    expect(current.status).toBe('failed'); expect(current.error).toContain('API_KEY');
    const retry = await fetch(`${base}/api/jobs/${job.id}/retry`, {method:'POST'});
    expect(retry.status).toBe(202); expect((await retry.json()).id).not.toBe(job.id);
    const project = await (await fetch(`${base}/api/project`)).json(); expect(project.items[0].id).toBe(sourceId);
  });
  it('validates custom instructions and retains them when retrying',async()=>{
    const post=(body:unknown)=>fetch(`${base}/api/decompose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const invalid=await post({sourceId,mode:'custom',instructions:'   '});expect(invalid.status).toBe(400);expect((await invalid.json()).error).toBe('请填写拆分要求。');
    expect((await post({sourceId,mode:'invalid'})).status).toBe(400);
    const response=await post({sourceId,mode:'custom',instructions:'  猫和帽子分开，文字放一起  '});expect(response.status).toBe(202);
    const job=await response.json();expect(job.request).toMatchObject({mode:'custom',instructions:'猫和帽子分开，文字放一起'});
    let current=job;
    for(let index=0;index<50&&current.status!=='failed';index++){await new Promise(resolve=>setTimeout(resolve,30));current=await(await fetch(`${base}/api/jobs/${job.id}`)).json();}
    const retry=await fetch(`${base}/api/jobs/${job.id}/retry`,{method:'POST'});expect(retry.status).toBe(202);
    expect((await retry.json()).request).toMatchObject({mode:'custom',instructions:'猫和帽子分开，文字放一起'});
  });
  it('places generation away from existing cards before calling the model', async () => {
    const response = await fetch(`${base}/api/generate`, { method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ prompt:'A test image', position:{x:150,y:80} }) });
    expect(response.status).toBe(202);
    const job = await response.json();
    expect(job.position).not.toEqual({x:150,y:80});
    expect(job.request.position).toEqual(job.position);
    // The uploaded 90:60 original occupies 380 × 323.33 canvas units at (150, 80).
    const {x,y}=job.position;
    expect(x+380<=150 || x>=530 || y+420<=80 || y>=403.34).toBe(true);
  });
  it('deletes and restores a group without deleting its source or material assets', async () => {
    const before = await (await fetch(`${base}/api/project`)).json();
    const group = before.items.find((item:{kind:string})=>item.kind==='layer-group');
    const patch = (body:unknown) => fetch(`${base}/api/project`, { method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
    const deleted = await (await patch({deleteIds:[group.id]})).json();
    expect(deleted.items.some((item:{id:string})=>item.id===group.id)).toBe(false);
    expect(deleted.items.some((item:{id:string})=>item.id===sourceId)).toBe(true);
    expect((await fetch(`${base}${group.layers[0].asset.url}`)).status).toBe(200);
    await patch({items:[group]});
    const restored = await (await fetch(`${base}/api/project`)).json();
    expect(restored.items.find((item:{id:string})=>item.id===group.id)).toEqual(group);
  });
});
