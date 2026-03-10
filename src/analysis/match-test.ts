import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { logger } from '../shared/logger.js';
import type { ApiInputRow } from '../shared/types.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * Test all 33 API inputs against the matching API.
 * Calculate match rate and generate results report.
 */
async function main() {
  // Read test inputs
  const csvContent = readFileSync('SampleData/API-input-sample.csv', 'utf-8');
  const inputs: ApiInputRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  logger.info(`Testing ${inputs.length} inputs against ${API_URL}/api/match`);

  const results: Array<{
    input: ApiInputRow;
    matched: boolean;
    company_name: string | null;
    confidence: number;
    match_quality: string;
    matched_on: string[];
  }> = [];

  let matched = 0;
  let totalConfidence = 0;

  for (const [idx, input] of inputs.entries()) {
    try {
      const response = await fetch(`${API_URL}/api/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input['input name'] || '',
          website: input['input website'] || '',
          phone_number: input['input phone'] || '',
          facebook_profile: input['input_facebook'] || '',
        }),
      });

      const data = (await response.json()) as Record<string, any>;
      const isMatched = response.status === 200 && data.match_details?.confidence_score > 0.2;
      const confidence = data.match_details?.confidence_score || 0;

      if (isMatched) {
        matched++;
        totalConfidence += confidence;
      }

      results.push({
        input,
        matched: isMatched,
        company_name: data.company_name || null,
        confidence,
        match_quality: data.match_details?.match_quality || 'NO_MATCH',
        matched_on: data.match_details?.matched_on || [],
      });

      const status = isMatched ? '✓' : '✗';
      const inputSummary = input['input name'] || input['input website'] || input['input phone'] || '(empty)';
      console.log(
        `  ${status} [${(idx + 1).toString().padStart(2)}/${inputs.length}] ` +
        `${inputSummary.substring(0, 40).padEnd(42)} → ` +
        `${isMatched ? data.company_name?.substring(0, 30) : 'NO MATCH'} ` +
        `(${(confidence * 100).toFixed(0)}% ${data.match_details?.match_quality || ''})`,
      );
    } catch (err) {
      logger.error(`Error testing input ${idx + 1}:`, err);
      results.push({
        input,
        matched: false,
        company_name: null,
        confidence: 0,
        match_quality: 'ERROR',
        matched_on: [],
      });
    }
  }

  const matchRate = matched / inputs.length;
  const avgConfidence = matched > 0 ? totalConfidence / matched : 0;

  console.log('\n' + '═'.repeat(60));
  console.log(`  MATCH RATE: ${matched}/${inputs.length} (${(matchRate * 100).toFixed(1)}%)`);
  console.log(`  AVG CONFIDENCE (matched): ${(avgConfidence * 100).toFixed(1)}%`);
  console.log('═'.repeat(60));

  // Confidence distribution
  const buckets = { high: 0, medium: 0, low: 0, none: 0 };
  for (const r of results) {
    if (r.confidence > 0.7) buckets.high++;
    else if (r.confidence > 0.4) buckets.medium++;
    else if (r.confidence > 0.2) buckets.low++;
    else buckets.none++;
  }
  console.log(`  High confidence (>70%):  ${buckets.high}`);
  console.log(`  Medium (40-70%):         ${buckets.medium}`);
  console.log(`  Low (20-40%):            ${buckets.low}`);
  console.log(`  No match (<20%):         ${buckets.none}`);
  console.log('═'.repeat(60));

  // Match type breakdown
  const matchTypes: Record<string, number> = {};
  for (const r of results) {
    for (const field of r.matched_on) {
      matchTypes[field] = (matchTypes[field] || 0) + 1;
    }
  }
  console.log('  Match type breakdown:');
  for (const [type, count] of Object.entries(matchTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log('═'.repeat(60));

  // Unmatched
  const unmatched = results.filter((r) => !r.matched);
  if (unmatched.length > 0) {
    console.log('  Unmatched inputs:');
    for (const r of unmatched) {
      console.log(`    - name="${r.input['input name']}" website="${r.input['input website']}" phone="${r.input['input phone']}" fb="${r.input['input_facebook']}"`);
    }
  }

  // Save results
  const output = {
    generated_at: new Date().toISOString(),
    total: inputs.length,
    matched,
    match_rate: parseFloat(matchRate.toFixed(4)),
    avg_confidence: parseFloat(avgConfidence.toFixed(4)),
    confidence_distribution: buckets,
    match_type_breakdown: matchTypes,
    results,
  };

  mkdirSync('output', { recursive: true });
  writeFileSync('output/match-results.json', JSON.stringify(output, null, 2));
  logger.info('Match results saved to output/match-results.json');

  // Exit with error if below threshold
  if (matchRate < 0.85) {
    logger.warn(`Match rate ${(matchRate * 100).toFixed(1)}% is below 85% target`);
  }
}

main().catch((err) => {
  logger.error('Match test failed:', err);
  process.exit(1);
});
