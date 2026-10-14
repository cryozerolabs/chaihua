import { describe, expect, it } from 'vitest';
import { modelSettings } from '../server/config';

const env = { MODEL_PROVIDER: 'zenmux', MODEL_BASE_URL: 'https://zenmux.ai/api/v1', API_KEY: 'local-key',
  DESIGN_MODEL: 'custom/design', LAYER_MODEL: 'custom/layer', VISION_MODEL: 'custom/vision' };
describe('model configuration', () => {
  it('reads provider, base URL and every model from env without hardcoded model defaults', () => {
    expect(modelSettings(env)).toMatchObject({ provider: 'zenmux', configured: true,
      baseUrl: env.MODEL_BASE_URL, models: { design: 'custom/design', layer: 'custom/layer', vision: 'custom/vision' } });
    const missing = modelSettings({ ...env, LAYER_MODEL: '' }); expect(missing.configured).toBe(false);
    expect(missing.error).toContain('LAYER_MODEL'); expect(missing.models.layer).toBe('');
  });
  it('reports a missing generic API_KEY', () => {
    const settings = modelSettings({ ...env, API_KEY: '' });
    expect(settings.apiKey).toBe(''); expect(settings.error).toContain('API_KEY');
  });
  it('switches provider, protocol and credentials entirely through env', () => {
    const settings = modelSettings({ ...env, MODEL_PROVIDER: 'openrouter', MODEL_BASE_URL: 'https://openrouter.ai/api/v1/',
      IMAGE_API_FORMAT: 'openrouter', API_KEY: 'openrouter-key' });
    expect(settings.apiKey).toBe('openrouter-key'); expect(settings.providerName).toBe('OpenRouter');
    expect(settings.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(settings.paths).toEqual({ generate: '/images', edit: '/images', vision: '/chat/completions' });
    const another = modelSettings({ ...env, MODEL_PROVIDER: 'another-platform', IMAGE_GENERATION_PATH: '/custom/generate' });
    expect(another.configured).toBe(true); expect(another.apiKey).toBe('local-key'); expect(another.paths.generate).toBe('/custom/generate');
  });
  it('rejects missing provider, invalid URLs, protocols and endpoint paths', () => {
    expect(modelSettings({ ...env, MODEL_PROVIDER: '' }).error).toContain('MODEL_PROVIDER');
    expect(modelSettings({ ...env, MODEL_BASE_URL: 'invalid' }).error).toContain('MODEL_BASE_URL');
    expect(modelSettings({ ...env, MODEL_BASE_URL: 'https://user:secret@example.com/v1' }).configured).toBe(false);
    expect(modelSettings({ ...env, IMAGE_API_FORMAT: 'unknown' }).error).toContain('IMAGE_API_FORMAT');
    expect(modelSettings({ ...env, IMAGE_EDIT_PATH: '//another.example/edit' }).configured).toBe(false);
  });
});
