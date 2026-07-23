import { describe, expect, it } from 'vitest'
import { canSaveModelConfig, getModelConfigNotice } from './useModelConfig'

describe('model configuration notices', () => {
  it('prioritizes restart-required guidance', () => {
    expect(
      getModelConfigNotice({
        ok: true,
        securelyStored: true,
        backendConfigured: false,
        restartRequired: true
      })
    ).toContain('重启桌面应用后生效')
  })

  it('reports secure storage for model and optional speech credentials', () => {
    expect(
      getModelConfigNotice(
        {
          ok: true,
          securelyStored: true,
          backendConfigured: true,
          restartRequired: false
        },
        true
      )
    ).toBe('模型配置已安全保存并接入后端，语音识别已启用')
  })

  it('reports model-only configuration when ASR is omitted', () => {
    expect(
      getModelConfigNotice({
        ok: true,
        securelyStored: true,
        backendConfigured: true,
        restartRequired: false
      })
    ).toBe('模型配置已安全保存并接入后端')
  })

  it('warns when credentials cannot be persisted securely', () => {
    expect(
      getModelConfigNotice({
        ok: true,
        securelyStored: false,
        backendConfigured: true,
        restartRequired: false
      })
    ).toContain('密钥不会落盘')
  })

  it('allows the model credential to be saved without ASR', () => {
    expect(
      canSaveModelConfig({
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        apiKey: '',
        asrApiKey: '',
        status: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1',
          modelApiKeyStored: true,
          asrApiKeyStored: false
        },
        backendConnection: 'connected',
        loading: false,
        saving: false
      })
    ).toBe(true)
  })

  it('blocks saving while the backend is unavailable', () => {
    expect(
      canSaveModelConfig({
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        apiKey: 'model-key',
        asrApiKey: 'asr-key',
        status: null,
        backendConnection: 'failed',
        loading: false,
        saving: false
      })
    ).toBe(false)
  })
})
