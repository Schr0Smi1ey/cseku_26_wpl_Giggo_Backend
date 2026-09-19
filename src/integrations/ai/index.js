import { config } from '../../config/index.js';
import { analyzeWithHeuristics } from './heuristic.js';

const providers = {
  heuristic: analyzeWithHeuristics,
};

export async function analyzeCvText(text, profile) {
  const provider = providers[config.ai.provider];
  if (!provider) throw new Error(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
  return { provider: config.ai.provider, result: await provider(text, profile) };
}
