const DEFAULT_DIGITALOCEAN_EMBEDDING_MODEL = "qwen3-embedding-0.6b";
const DEFAULT_DIGITALOCEAN_BASE_URL = "https://inference.do-ai.run";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_BASE_URL = "https://api.openai.com";

type EmbeddingProvider = "digitalocean" | "openai" | "nvidia";

/**
 * Asymmetric embedding models (e.g. NVIDIA nv-embedqa-e5-v5) embed documents and
 * queries into different sub-spaces and MUST be told which is which. Corpus/chunks
 * are "passage"; the user's search string is "query". Using the same type for both
 * measurably degrades retrieval relevance.
 */
export type EmbeddingInputType = "query" | "passage";

interface EmbeddingItem {
  index: number;
  embedding: number[];
}

interface EmbeddingResponse {
  data: EmbeddingItem[];
}

export interface EmbedOptions {
  model?: string;
  apiKey?: string;
  provider?: EmbeddingProvider;
  /** "query" (default) for search strings, "passage" for indexed documents. */
  inputType?: EmbeddingInputType;
}

export async function embedTexts(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];

  const provider = options.provider ?? getEmbeddingProvider();
  const apiKey = options.apiKey ?? getEmbeddingApiKey(provider);
  if (!apiKey) {
    throw new Error(`${provider === "digitalocean" ? "DIGITALOCEAN_TOKEN" : provider === "nvidia" ? "NVIDIA_API_KEY" : "OPENAI_API_KEY"} is required to generate embeddings`);
  }

  const model = options.model ?? getEmbeddingModel(provider);
  const inputType = options.inputType ?? "query";
  const response = await fetch(`${getEmbeddingBaseUrl(provider).replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildEmbeddingRequest(provider, model, texts, inputType)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} embeddings request failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const ordered = [...payload.data].sort((a, b) => a.index - b.index);

  if (ordered.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, received ${ordered.length}`);
  }

  return ordered.map((item) => item.embedding);
}

function getEmbeddingProvider(): EmbeddingProvider {
  if (process.env.EMBEDDING_PROVIDER === "openai") return "openai";
  if (process.env.EMBEDDING_PROVIDER === "nvidia") return "nvidia";
  return "digitalocean";
}

function getEmbeddingApiKey(provider: EmbeddingProvider): string | undefined {
  if (provider === "digitalocean") return process.env.DIGITALOCEAN_TOKEN;
  if (provider === "nvidia") return process.env.NVIDIA_API_KEY;
  return process.env.OPENAI_API_KEY;
}

function getEmbeddingModel(provider: EmbeddingProvider): string {
  if (provider === "digitalocean") {
    return process.env.DIGITALOCEAN_EMBEDDING_MODEL ?? DEFAULT_DIGITALOCEAN_EMBEDDING_MODEL;
  }
  if (provider === "nvidia") {
    return process.env.NVIDIA_EMBEDDING_MODEL ?? "nvidia/nv-embedqa-e5-v5";
  }

  return process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
}

function getEmbeddingBaseUrl(provider: EmbeddingProvider): string {
  if (provider === "digitalocean") {
    return process.env.DIGITALOCEAN_INFERENCE_BASE_URL ?? DEFAULT_DIGITALOCEAN_BASE_URL;
  }
  if (provider === "nvidia") {
    return process.env.NVIDIA_EMBEDDING_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  }

  return OPENAI_BASE_URL;
}

function buildEmbeddingRequest(
  provider: EmbeddingProvider,
  model: string,
  input: string[],
  inputType: EmbeddingInputType,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    input,
    encoding_format: "float",
  };

  if (provider === "nvidia") {
    request.input_type = inputType;
  }

  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);
  if (provider === "openai" && Number.isInteger(dimensions) && dimensions > 0) {
    request.dimensions = dimensions;
  }

  return request;
}
