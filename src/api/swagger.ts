import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Veridion SWE Challenge — Company Match API',
      version: '1.0.0',
      description:
        'REST API that matches company profiles by name, website, phone, or Facebook profile. ' +
        'Response schema mirrors Veridion\'s Match & Enrich API with confidence scoring and per-attribute match details.',
      contact: {
        name: 'Bogdan',
        url: 'https://github.com/bogdansys/veridion-swe',
      },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local dev' },
    ],
    paths: {
      '/api/match': {
        post: {
          summary: 'Match a company profile',
          description:
            'Accepts company identifiers and returns the best matching company profile with confidence scoring. ' +
            'Uses multi-strategy matching: exact domain → exact phone → exact Facebook → composite → fuzzy name.',
          tags: ['Matching'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'SafetyChain Software Services Pty. Ltd.' },
                    website: { type: 'string', example: 'https://safetychain.com/about-us' },
                    phone_number: { type: 'string', example: '(786) 426-3492' },
                    facebook_profile: { type: 'string', example: 'https://www.facebook.com/acornfurnitureworkshops' },
                  },
                },
                examples: {
                  'Website + Name': {
                    value: { name: 'SafetyChain Software Services Pty. Ltd.', website: 'https://safetychain.com/about-us', phone_number: '', facebook_profile: '' },
                  },
                  'Phone only': {
                    value: { name: '', website: '', phone_number: '(786) 426-3492', facebook_profile: '' },
                  },
                  'Tricky - garbage name + website': {
                    value: { name: '..', website: 'steppir.com', phone_number: '', facebook_profile: 'https://www.facebook.com/SteppIR/' },
                  },
                  'Facebook only': {
                    value: { name: 'Inc.', website: '', phone_number: '', facebook_profile: 'https://facebook.com/bluemercury' },
                  },
                  'Name only - fuzzy': {
                    value: { name: 'SBS*', website: '', phone_number: '', facebook_profile: '' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Matched company profile (Veridion-style response)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      match_details: {
                        type: 'object',
                        properties: {
                          confidence_score: { type: 'number', example: 0.92 },
                          match_quality: { type: 'string', enum: ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNCERTAIN'] },
                          matched_on: { type: 'array', items: { type: 'string' }, example: ['website', 'name'] },
                          attributes: { type: 'object' },
                        },
                      },
                      company_name: { type: 'string' },
                      website_domain: { type: 'string' },
                      primary_phone: { type: 'string', nullable: true },
                      facebook_url: { type: 'string', nullable: true },
                      short_description: { type: 'string', nullable: true },
                      technologies: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
            '404': { description: 'No matching company found' },
          },
        },
      },
      '/api/health': {
        get: {
          summary: 'Health check',
          tags: ['System'],
          responses: { '200': { description: 'API and service health status' } },
        },
      },
      '/api/stats': {
        get: {
          summary: 'Crawl & match statistics',
          tags: ['Analytics'],
          responses: { '200': { description: 'Crawl coverage, fill rates, match rate' } },
        },
      },
    },
  },
  apis: [], // We define paths inline above
};

export const swaggerSpec = swaggerJsdoc(options);
