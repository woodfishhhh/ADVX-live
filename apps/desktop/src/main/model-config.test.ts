import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../shared/contracts";
import { resolveModelConfig } from "./model-config";

const storedConfig: ModelConfig = {
  baseUrl: "https://stored.example/v1",
  model: "stored-model",
  apiKey: "stored-model-key",
  asrApiKey: "stored-asr-key"
};

describe("model configuration", () => {
  it("reuses safely stored credentials when replacement fields are blank", () => {
    expect(
      resolveModelConfig(
        {
          baseUrl: " https://new.example/v1 ",
          model: " new-model ",
          apiKey: "",
          asrApiKey: "   "
        },
        storedConfig
      )
    ).toEqual({
      baseUrl: "https://new.example/v1",
      model: "new-model",
      apiKey: "stored-model-key",
      asrApiKey: "stored-asr-key"
    });
  });

  it("replaces only credentials explicitly entered by the user", () => {
    expect(
      resolveModelConfig(
        {
          baseUrl: "https://new.example/v1",
          model: "new-model",
          apiKey: " new-model-key ",
          asrApiKey: ""
        },
        storedConfig
      )
    ).toMatchObject({
      apiKey: "new-model-key",
      asrApiKey: "stored-asr-key"
    });
  });

  it("allows model-only configuration when ASR is not used", () => {
    expect(
      resolveModelConfig(
        {
          baseUrl: "https://new.example/v1",
          model: "new-model",
          apiKey: "new-model-key",
          asrApiKey: ""
        },
        null
      )
    ).toEqual({
      baseUrl: "https://new.example/v1",
      model: "new-model",
      apiKey: "new-model-key",
      asrApiKey: ""
    });
  });

  it("requires the model credential when none is stored", () => {
    expect(() =>
      resolveModelConfig(
        {
          baseUrl: "https://new.example/v1",
          model: "new-model",
          apiKey: "",
          asrApiKey: ""
        },
        null
      )
    ).toThrow("模型地址、模型名称和模型密钥均为必填项。");
  });
});
