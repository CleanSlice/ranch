export interface IModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, IModelPricing> = {
  'claude-haiku-4-5': { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-opus-4-7': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

// The one lookup both functions below go through, so "has a price" and
// "what it costs" cannot disagree about a model. Own keys only: a model
// named like something every object has ("constructor") is not in the list.
function priceOf(model: string): IModelPricing | undefined {
  return Object.hasOwn(PRICING, model) ? PRICING[model] : undefined;
}

/**
 * Whether the model is in the price list. `costUsd` answers 0 for a model
 * that is not, which reads as "free"; a caller that must tell an unpriced
 * model from a free one asks here first (CLEAN-261).
 */
export function hasPrice(model: string): boolean {
  return priceOf(model) !== undefined;
}

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceOf(model);
  if (!p) return 0;
  return (
    (inputTokens / 1_000_000) * p.inputPerMillion +
    (outputTokens / 1_000_000) * p.outputPerMillion
  );
}
