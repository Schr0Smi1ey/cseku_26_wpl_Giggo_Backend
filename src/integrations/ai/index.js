import { config } from '../../config/index.js';
import { analyzeWithHeuristics } from './heuristic.js';
import { draftProposalWithHeuristics } from './proposal-draft.js';

const providers = {
  heuristic: analyzeWithHeuristics,
};

export async function analyzeCvText(text, profile) {
  const provider = providers[config.ai.provider];
  if (!provider) throw new Error(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
  return { provider: config.ai.provider, result: await provider(text, profile) };
}

export async function draftProposalText(job, profile, tone, notes) {
  const supported = config.ai.provider === 'heuristic';
  return {
    provider: supported ? 'heuristic' : 'heuristic-fallback',
    result: await draftProposalWithHeuristics(job, profile, tone, notes),
  };
}
