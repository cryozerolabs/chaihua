import "dotenv/config";
import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { modelSettings } from './config';

export const MODEL_IDS = modelSettings().models;

function redactSecrets(message: string): string {
  for (const key of [process.env.API_KEY])
    if (key?.trim()) message = message.split(key.trim()).join('[已隐藏]');
  return message.replace(/sk-(?:or|ai|ss)-v1-[a-zA-Z0-9_-]+/g, '[已隐藏]');
}

export function safeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : '操作失败，请重试。').slice(0, 450);
}

export type RetryProgress = (message: string) => void | Promise<void>;
const MODEL_LABELS = {
  [MODEL_IDS.design]: "Ming Design",
  [MODEL_IDS.layer]: "Ming Layer",
  [MODEL_IDS.vision]: 'Ling-VL',
};

async function waitToRetry(
  delay: number,
  attempt: number,
  progress?: RetryProgress,
) {
  const deadline = Date.now() + delay;
  do {
    const remaining = Math.max(0, deadline - Date.now());
    if (!remaining) break;
    await progress?.(
      `服务暂时繁忙，${Math.ceil(remaining / 1000)} 秒后自动重试（${attempt}/4）`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(5000, remaining)),
    );
  } while (Date.now() < deadline);
  await progress?.(`正在自动重试（${attempt}/4）`);
}

async function request(
  endpoint: string,
  body: unknown,
  timeout: number,
  progress?: RetryProgress,
) {
  const settings = modelSettings();
  if (settings.error) throw new Error(settings.error);
  const multipart = body instanceof FormData;
  const model = (multipart ? String(body.get('model') ?? '模型') : (body as { model?: string }).model) ?? '模型';
  const label = MODEL_LABELS[model] ?? model;
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${settings.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          ...(!multipart ? { "Content-Type": "application/json" } : {}),
        },
        body: multipart ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (attempt < 2 && (error as Error).name !== "TimeoutError") {
        await progress?.(`连接中断，正在重新连接（${attempt + 1}/2）`);
        await new Promise((resolve) =>
          setTimeout(resolve, 1500 * 2 ** attempt),
        );
        continue;
      }
      throw new Error(
        (error as Error).name === "TimeoutError"
          ? "模型响应超时，可以重试当前步骤。"
          : "连接模型服务失败，请检查网络后重试。",
      );
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new Error("模型响应读取中断，请重试当前步骤。");
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(
        `模型服务返回了不完整的响应（HTTP ${response.status}），请重试当前步骤。`,
      );
    }
    if (response.ok && !payload?.error) return payload;
    const status = response.ok
      ? Number(payload?.error?.code) || 500
      : response.status;
    const directory = path.resolve(process.env.DATA_DIR ?? ".data", "debug");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, `${Date.now()}-provider-error.json`),
      redactSecrets(JSON.stringify(
        {
          provider: settings.provider,
          endpoint,
          model,
          status,
          attempt: attempt + 1,
          routing: (body as { provider?: unknown }).provider,
          retryAfter: response.headers.get("retry-after"),
          error: payload?.error,
        },
        null,
        2,
      )),
    );
    if ([429, 502, 503, 504].includes(status) && attempt < 4) {
      const retry = response.headers.get("retry-after");
      const fallback = Math.min(60_000, 15_000 * 2 ** attempt);
      const retryDelay = retry
        ? /^\d+(?:\.\d+)?$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : fallback;
      await waitToRetry(
        Math.max(1000, Number.isFinite(retryDelay) ? retryDelay : fallback),
        attempt + 1,
        progress,
      );
      continue;
    }
    const friendly =
      status === 401
        ? `${settings.providerName} 密钥无效，请检查 .env 中的 ${settings.keyVariable}。`
        : status === 402
          ? `${settings.providerName} 账户额度不足，请检查账户余额。`
          : status === 404 && /No endpoints? found/i.test(payload?.error?.message ?? '')
            ? `${settings.providerName} 当前没有 ${label} 的可用线路，请检查模型 ID 或该平台的模型服务状态`
          : status === 429
            ? `${label} 持续限流，已自动重试 4 次，请稍后重试这一步`
            : `${label} 调用失败（HTTP ${status}）`;
    let upstream = payload?.error?.metadata?.raw;
    try {
      if (typeof upstream === "string") upstream = JSON.parse(upstream);
    } catch {
      /* Some providers return plain text. */
    }
    const detail =
      upstream?.error?.message ??
      upstream?.message ??
      (typeof upstream === "string" ? upstream : payload?.error?.message);
    throw new Error(
      safeError(
        new Error(
          `${friendly}${detail && detail !== "Provider returned error" ? `：${detail}` : ""}`,
        ),
      ),
    );
  }
  throw new Error(`${label} 暂时不可用，请稍后重试。`);
}

export async function askVision<T extends z.ZodType>(name: string, schema: T, instruction: string, images: Buffer[], progress?: RetryProgress): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  const body = {
    model: MODEL_IDS.vision, temperature: 0.2, max_tokens: 16000, reasoning: { enabled: false },
    messages: [
      { role: 'system', content: `Inspect the supplied images and return only JSON conforming to this schema: ${JSON.stringify(jsonSchema)}` },
      { role: 'user', content: [{ type: 'text', text: instruction }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } }))] },
    ],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } },
  };
  const payload = await request(modelSettings().paths.vision, body, 180000, progress);
  const message = payload?.choices?.[0]?.message?.content;
  const content = typeof message === 'string' ? message : Array.isArray(message) ? message.map((part: { text?: string }) => part.text ?? '').join('') : '';
  const finishReason = payload?.choices?.[0]?.finish_reason;
  try {
    if (finishReason === 'length') throw new Error('Output was truncated');
    const cleaned = content.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    let data;
    try { data = JSON.parse(cleaned); } catch { data = JSON.parse(jsonrepair(cleaned)); }
    return schema.parse(data);
  } catch (error) {
    const directory = path.resolve(process.env.DATA_DIR ?? '.data', 'debug');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${Date.now()}-${name}.json`), redactSecrets(JSON.stringify({ name, finishReason, content,
      validation: error instanceof z.ZodError ? error.issues : safeError(error) }, null, 2)));
    if (finishReason === 'length') throw new Error('Ling-VL 的拆层方案输出被截断，请重试当前步骤。');
    if (error instanceof z.ZodError) {
      const field = error.issues[0]?.path.join('.') || 'JSON';
      throw new Error(`Ling-VL 的方案字段不符合要求（${field}），请重试当前步骤。`);
    }
    throw new Error('Ling-VL 未返回有效的 JSON 方案，请重试当前步骤。');
  }
}

export async function generateImages(
  model: string,
  prompt: string,
  reference?: Buffer,
  progress?: RetryProgress,
): Promise<Buffer[]> {
  let body: Record<string, unknown> | FormData = {
    model,
    prompt,
    output_format: "png",
    n: 1,
  };
  const settings = modelSettings();
  const endpoint = reference ? settings.paths.edit : settings.paths.generate;
  if (reference && settings.imageFormat === 'openai') {
    if (settings.editEncoding === 'multipart') {
      const form = new FormData();
      for (const [key, value] of Object.entries(body)) form.append(key, String(value));
      form.append('image', new Blob([new Uint8Array(reference)], { type: 'image/png' }), 'original.png');
      body = form;
    } else body.images = [{ image_url: `data:image/png;base64,${reference.toString('base64')}` }];
  } else if (reference) body.input_references = [
      {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${reference.toString("base64")}`,
        },
      },
    ];
  const payload = await request(endpoint, body, 600_000, progress);
  const data = payload?.data;
  if (!Array.isArray(data) || data.length === 0)
    throw new Error("模型没有返回图片，请重试。");
  return Promise.all(
    data.map(async (entry: { b64_json?: string; url?: string }) => {
      if (entry.b64_json)
        return Buffer.from(
          entry.b64_json.replace(/^data:[^,]+,/, ""),
          "base64",
        );
      if (entry.url) {
        const response = await fetch(entry.url, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error("素材下载失败，请重试。");
        return Buffer.from(await response.arrayBuffer());
      }
      throw new Error("模型返回的图片数据不完整。");
    }),
  );
}
