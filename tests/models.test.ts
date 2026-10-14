import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { askVision, generateImages, MODEL_IDS, safeError } from '../server/models';
import { layerPlanSchema } from '../server/pipeline';

let directory: string | undefined;
beforeEach(() => {
  vi.stubEnv('MODEL_PROVIDER', 'openrouter'); vi.stubEnv('MODEL_BASE_URL', 'https://openrouter.ai/api/v1');
  vi.stubEnv('API_KEY', 'test-key'); vi.stubEnv('IMAGE_API_FORMAT', 'openrouter');
  vi.stubEnv('IMAGE_GENERATION_PATH', '/images'); vi.stubEnv('IMAGE_EDIT_PATH', '/images'); vi.stubEnv('VISION_API_PATH', '/chat/completions');
});
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('VL model requests', () => {
  const plan = { layoutType: 'asset-sheet', backgroundDescription: '白色背景',
    foregroundLayers: Array.from({ length: 28 }, (_, index) => ({ name: `元素 ${index + 1}`, role: 'decoration', description: `独立元素 ${index + 1}` })) };
  const visionResponse = (content: string, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }));
  async function prepare() {
    directory = await mkdtemp(path.join(tmpdir(), 'ming-vision-')); vi.stubEnv('DATA_DIR', directory); vi.stubEnv('API_KEY', 'test-key');
  }
  it('accepts large plans and sends the image with a JSON schema', async () => {
    await prepare(); const mockedFetch = vi.fn().mockResolvedValue(visionResponse(JSON.stringify(plan))); vi.stubGlobal('fetch', mockedFetch);
    const image = Buffer.from('original-preview');
    const result = await askVision('layer_plan', layerPlanSchema, '看图拆分', [image]);
    expect(result.foregroundLayers).toHaveLength(28);
    const [url, init] = mockedFetch.mock.calls[0]; expect(url).toMatch(/\/chat\/completions$/);
    const body = JSON.parse(init.body); expect(body.model).toBe(MODEL_IDS.vision); expect(body.max_tokens).toBe(16000);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[1].content[1].image_url.url).toBe(`data:image/png;base64,${image.toString('base64')}`);
  });
  it('rejects truncated plans even when the partial JSON would parse', async () => {
    await prepare(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse(JSON.stringify(plan), 'length')));
    await expect(askVision('layer_plan', layerPlanSchema, '看图拆分', [])).rejects.toThrow('输出被截断');
  });
  it('reports the failing field instead of claiming all plans are incomplete', async () => {
    await prepare(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse(JSON.stringify({ ...plan, backgroundDescription: undefined }))));
    await expect(askVision('layer_plan', layerPlanSchema, '看图拆分', [])).rejects.toThrow('backgroundDescription');
  });
  it('identifies model-whitelist denials using the configured vision model without retrying', async () => {
    await prepare();
    const mockedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'The requested model is not included in this API key\'s allowed model list' } }), { status: 403 }));
    vi.stubGlobal('fetch', mockedFetch);
    await expect(askVision('layer_plan', layerPlanSchema, '看图拆分', []))
      .rejects.toThrow(`未授权调用 视觉模型（${MODEL_IDS.vision}），请检查 API key 的模型白名单。`);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
  it('repairs fenced JSON with a trailing comma', async () => {
    await prepare(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse('```json\n' + JSON.stringify(plan).replace(/}$/, ',}') + '\n```')));
    await expect(askVision('layer_plan', layerPlanSchema, '看图拆分', [])).resolves.toMatchObject({ backgroundDescription: '白色背景' });
  });
  it('retries an overloaded VL request with its schema and images preserved without forcing an unavailable provider', async () => {
    await prepare(); vi.useFakeTimers(); const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 429, message: 'Provider returned error', metadata: { provider_name: 'DeepInfra' } } }), { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(visionResponse(JSON.stringify(plan)));
    vi.stubGlobal('fetch', mockedFetch); const stages: string[] = [];
    let beganWaiting!: () => void; const waiting = new Promise<void>(resolve => { beganWaiting = resolve; });
    const result = askVision('layer_plan', layerPlanSchema, '看图拆分', [Buffer.from('reference')], message => { stages.push(message); beganWaiting(); });
    await waiting; await vi.advanceTimersByTimeAsync(2000); await result;
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(mockedFetch.mock.calls[0][1].body), fallback = JSON.parse(mockedFetch.mock.calls[1][1].body);
    expect(fallback.model).toBe(first.model); expect(fallback.messages).toEqual(first.messages);
    expect(fallback.provider).toBeUndefined(); expect(fallback.response_format).toEqual(first.response_format);
    expect(fallback.messages[0].content).toContain('foregroundLayers'); expect(stages[0]).toContain('自动重试');
  });
});
const response = () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('image-result').toString('base64') }] }));

describe('image model requests', () => {
  it('reports interrupted response bodies', async () => {
    vi.stubEnv('API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true,status:200,text:async()=>{throw new DOMException('aborted','AbortError');} }));
    await expect(generateImages(MODEL_IDS.layer,'decompose',Buffer.from('reference'))).rejects.toThrow('模型响应读取中断');
  });
  it('reports malformed provider JSON', async () => {
    vi.stubEnv('API_KEY', 'test-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"data":',{status:200})));
    await expect(generateImages(MODEL_IDS.layer,'decompose')).rejects.toThrow('模型服务返回了不完整的响应');
  });
  it('sends one reference and the natural-language instructions directly to the image model', async () => {
    vi.stubEnv('API_KEY','test-key');const mockedFetch=vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch',mockedFetch);
    const reference=Buffer.from('reference');
    await expect(generateImages(MODEL_IDS.layer,'猫和帽子分开',reference)).resolves.toEqual([Buffer.from('image-result')]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toMatch(/\/images$/);
    const body=JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({model:MODEL_IDS.layer,prompt:'猫和帽子分开',n:1,output_format:'png'});
    expect(body.input_references).toEqual([{type:'image_url',image_url:{url:`data:image/png;base64,${reference.toString('base64')}`}}]);
    expect(body.messages).toBeUndefined();expect(body.response_format).toBeUndefined();
  });
  it('waits for Retry-After and reports the image model retry', async () => {
    directory=await mkdtemp(path.join(tmpdir(),'ming-models-'));vi.stubEnv('DATA_DIR',directory);vi.stubEnv('API_KEY','test-key');vi.useFakeTimers();
    const mockedFetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:{code:429,message:'Provider returned error'}}),{status:429,headers:{'retry-after':'2'}})).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch',mockedFetch);
    let beganWaiting!:()=>void;const waiting=new Promise<void>(resolve=>{beganWaiting=resolve;});const stages:string[]=[];
    const result=generateImages(MODEL_IDS.layer,'decompose',undefined,message=>{stages.push(message);beganWaiting();});
    await waiting;expect(mockedFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);expect(mockedFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);await expect(result).resolves.toEqual([Buffer.from('image-result')]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);expect(stages.some(message=>message.includes('2 秒后自动重试'))).toBe(true);
  });
  it('redacts credentials in errors',()=>{
    vi.stubEnv('API_KEY','local-secret-key');expect(safeError(new Error('local-secret-key failed sk-or-v1-abc123'))).not.toContain('local-secret-key');
    expect(safeError(new Error('sk-or-v1-abc123'))).toBe('[已隐藏]');
  });
  it('reports unavailable image endpoints without retrying a 404',async()=>{
    directory=await mkdtemp(path.join(tmpdir(),'ming-unavailable-'));vi.stubEnv('DATA_DIR',directory);vi.stubEnv('API_KEY','test-key');
    const mockedFetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:404,message:'No endpoint found for model'}}),{status:404}));vi.stubGlobal('fetch',mockedFetch);
    await expect(generateImages(MODEL_IDS.layer,'decompose')).rejects.toThrow('OpenRouter 当前没有 Ming Layer 的可用线路');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('ZenMux image protocol', () => {
  beforeEach(() => {
    vi.stubEnv('MODEL_PROVIDER', 'zenmux'); vi.stubEnv('MODEL_BASE_URL', 'https://zenmux.ai/api/v1/');
    vi.stubEnv('API_KEY', 'test-zenmux-key'); vi.stubEnv('IMAGE_API_FORMAT', 'openai');
    vi.stubEnv('IMAGE_EDIT_ENCODING', 'multipart');
    vi.stubEnv('IMAGE_GENERATION_PATH', '/images/generations'); vi.stubEnv('IMAGE_EDIT_PATH', '/images/edits');
  });
  it('uses the generation endpoint and the selected provider credential', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', mockedFetch);
    await expect(generateImages(MODEL_IDS.design, '零食海报')).resolves.toEqual([Buffer.from('image-result')]);
    const [url, options] = mockedFetch.mock.calls[0]; expect(url).toBe('https://zenmux.ai/api/v1/images/generations');
    expect(options.headers.Authorization).toBe('Bearer test-zenmux-key'); expect(options.headers['X-OpenRouter-Title']).toBeUndefined();
    const body = JSON.parse(options.body); expect(body).toMatchObject({ model: MODEL_IDS.design, prompt: '零食海报', n: 1, output_format: 'png' });
    expect(body.size).toBeUndefined(); expect(body.images).toBeUndefined();
  });
  it('uploads one binary image to images/edits and keeps every returned RGBA layer', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { b64_json: Buffer.from('foreground').toString('base64') }, { b64_json: Buffer.from('background').toString('base64') },
    ] }))); vi.stubGlobal('fetch', mockedFetch);
    const reference = Buffer.from('original');
    await expect(generateImages(MODEL_IDS.layer, 'Decompose this image into 2 layers.', reference))
      .resolves.toEqual([Buffer.from('foreground'), Buffer.from('background')]);
    const [url, options] = mockedFetch.mock.calls[0]; expect(url).toBe('https://zenmux.ai/api/v1/images/edits');
    const body = options.body as FormData; expect(body).toBeInstanceOf(FormData);
    expect(body.get('model')).toBe(MODEL_IDS.layer); expect(body.get('n')).toBe('1');
    expect(Buffer.from(await (body.get('image') as Blob).arrayBuffer()).equals(reference)).toBe(true);
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(body.has('input_references')).toBe(false); expect(body.has('size')).toBe(false);
  });
  it('can switch to JSON image references using env alone', async () => {
    vi.stubEnv('IMAGE_EDIT_ENCODING', 'json'); const mockedFetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', mockedFetch);
    const reference = Buffer.from('original'); await generateImages(MODEL_IDS.layer, 'decompose', reference);
    const options = mockedFetch.mock.calls[0][1]; expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body).images).toEqual([{ image_url: `data:image/png;base64,${reference.toString('base64')}` }]);
  });
  it('uses the same generic API_KEY variable on another OpenAI-compatible platform without code changes', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'another-platform'); vi.stubEnv('MODEL_BASE_URL', 'https://another.example/v1'); vi.stubEnv('API_KEY', 'another-key');
    const mockedFetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', mockedFetch);
    await generateImages(MODEL_IDS.design, 'test');
    expect(mockedFetch.mock.calls[0][0]).toBe('https://another.example/v1/images/generations');
    expect(mockedFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer another-key');
  });
  it('reports ZenMux authentication errors and redacts its keys', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'zenmux-auth-')); vi.stubEnv('DATA_DIR', directory);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 })));
    await expect(generateImages(MODEL_IDS.design, 'test')).rejects.toThrow('ZenMux 密钥无效');
    expect(safeError(new Error('test-zenmux-key sk-ai-v1-secret sk-ss-v1-secret'))).toBe('[已隐藏] [已隐藏] [已隐藏]');
  });
});
