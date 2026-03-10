import { Router, type Request, type Response } from 'express';
import { matchCompany } from '../matching/engine.js';
import { logger } from '../../shared/logger.js';
import type { MatchInput } from '../../shared/types.js';

const router = Router();

/**
 * POST /api/match
 * Match & return a company profile based on input fields.
 * Mirrors Veridion's Match & Enrich API response schema.
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const input: MatchInput = {
      name: req.body.name || '',
      website: req.body.website || '',
      phone_number: req.body.phone_number || '',
      facebook_profile: req.body.facebook_profile || '',
    };

    logger.debug(`Match request: ${JSON.stringify(input)}`);

    const result = await matchCompany(input);

    if (!result) {
      return res.status(404).json({
        match_details: {
          confidence_score: 0,
          match_quality: 'NO_MATCH',
          matched_on: [],
          attributes: {},
        },
        message: 'No matching company found for the provided input.',
      });
    }

    // Build Veridion-style response
    const company = result.company;
    const response = {
      match_details: result.match_details,
      company_name: company.commercial_name || company.legal_name || company.domain,
      company_commercial_names: company.commercial_name ? [company.commercial_name] : [],
      company_legal_names: company.legal_name ? [company.legal_name] : [],
      company_all_available_names: company.all_names || [],
      website_domain: company.domain,
      website_url: `https://${company.domain}`,
      primary_phone: company.phone_numbers?.[0] || null,
      phone_numbers: company.phone_numbers || [],
      primary_email: company.primary_email || null,
      emails: company.emails || [],
      facebook_url: company.facebook_url || null,
      social_links: company.social_links || {},
      short_description: company.short_description || null,
      technologies: company.technologies || [],
      main_address: company.addresses?.[0] || null,
      year_founded: company.year_founded || null,
      logo_url: company.logo_url || null,
    };

    return res.json(response);
  } catch (err) {
    logger.error('Match error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
