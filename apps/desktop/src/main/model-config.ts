import type { ModelConfig } from "../shared/contracts";

export function resolveModelConfig(
  input: ModelConfig,
  stored: ModelConfig | null
): ModelConfig {
  const resolved = {
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim(),
    apiKey: input.apiKey.trim() || stored?.apiKey || "",
    asrApiKey: input.asrApiKey.trim() || stored?.asrApiKey || ""
  };

  if (!resolved.baseUrl || !resolved.model || !resolved.apiKey) {
    throw new Error("模型地址、模型名称和模型密钥均为必填项。");
  }
  return resolved;
}
