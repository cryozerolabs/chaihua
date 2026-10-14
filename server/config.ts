import 'dotenv/config';

export function modelSettings(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.MODEL_PROVIDER?.trim().toLowerCase() ?? '';
  const baseUrl = (env.MODEL_BASE_URL?.trim() ?? '').replace(/\/+$/, '');
  const models = {
    design: env.DESIGN_MODEL?.trim() ?? '',
    layer: env.LAYER_MODEL?.trim() ?? '',
    vision: env.VISION_MODEL?.trim() ?? '',
  };
  const apiKey = env.API_KEY?.trim() ?? '';
  const keyVariable = 'API_KEY';
  const providerName = provider === 'zenmux' ? 'ZenMux' : provider === 'openrouter' ? 'OpenRouter' : provider || '模型服务';
  const imageFormat = env.IMAGE_API_FORMAT?.trim() || 'openai';
  const editEncoding = env.IMAGE_EDIT_ENCODING?.trim() || 'multipart';
  const defaultImagePath = imageFormat === 'openrouter' ? '/images' : '/images/generations';
  const paths = {
    generate: env.IMAGE_GENERATION_PATH?.trim() || defaultImagePath,
    edit: env.IMAGE_EDIT_PATH?.trim() || (imageFormat === 'openrouter' ? '/images' : '/images/edits'),
    vision: env.VISION_API_PATH?.trim() || '/chat/completions',
  };
  let error: string | undefined;
  if (!provider) error = '请在 .env 中配置 MODEL_PROVIDER，然后重启服务。';
  else if (!baseUrl) error = '请在 .env 中配置 MODEL_BASE_URL，然后重启服务。';
  else {
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { error = '.env 中的 MODEL_BASE_URL 格式不正确，请填写完整的 HTTP 或 HTTPS API 地址。'; }
  }
  const missing = (Object.entries(models) as [keyof typeof models, string][]).filter(([, value]) => !value)
    .map(([role]) => `${role.toUpperCase()}_MODEL`);
  if (!error && missing.length) error = `请在 .env 中配置 ${missing.join('、')}，然后重启服务。`;
  if (!error && !['openai', 'openrouter'].includes(imageFormat)) error = 'IMAGE_API_FORMAT 支持 openai 或 openrouter，请按平台文档选择。';
  if (!error && !['multipart', 'json'].includes(editEncoding)) error = 'IMAGE_EDIT_ENCODING 支持 multipart 或 json，请按平台文档选择。';
  if (!error && Object.values(paths).some(value => !/^\/(?!\/)[^?#]*$/.test(value))) error = '模型接口路径应以单个 / 开头，不能包含独立域名、查询参数或片段。';
  if (!error && (!apiKey || /^your_|^<|replace[_-]?me/i.test(apiKey))) error = `请在项目 .env 中配置 ${keyVariable}，然后重启服务。`;
  return { provider, providerName, baseUrl, apiKey, keyVariable, models, imageFormat, editEncoding, paths, configured: !error, error };
}
