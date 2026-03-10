import type { MatchQuality } from '../../shared/types.js';

/**
 * Determine match quality tier based on confidence score and matched fields.
 */
export function getMatchQuality(confidence: number, matchedFields: string[]): MatchQuality {
  const exactFields = matchedFields.filter((f) => f !== 'name');
  const hasMultipleExact = exactFields.length >= 2;
  const hasSingleExact = exactFields.length >= 1;

  if (confidence > 0.9 && hasMultipleExact) return 'VERIFIED';
  if (confidence > 0.7 && hasSingleExact) return 'HIGH';
  if (confidence > 0.5) return 'MEDIUM';
  if (confidence > 0.3) return 'LOW';
  return 'UNCERTAIN';
}

/**
 * Calculate weighted confidence from individual field match results.
 */
export function calculateWeightedConfidence(
  fieldConfidences: Record<string, number>,
): number {
  const weights: Record<string, number> = {
    website: 0.40,
    phone: 0.30,
    facebook: 0.20,
    name: 0.10,
    company_name: 0.10,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [field, confidence] of Object.entries(fieldConfidences)) {
    const weight = weights[field] || 0.05;
    weightedSum += weight * confidence;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
