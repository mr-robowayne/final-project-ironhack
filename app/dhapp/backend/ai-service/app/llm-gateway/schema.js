'use strict';

// JSON Schema for Structured Outputs (strict).
const medsAnswerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'matches', 'missingInfo', 'dataGaps', 'disclaimer'],
  properties: {
    summary: { type: 'string' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prepId', 'relevance', 'statements'],
        properties: {
          prepId: { type: 'integer' },
          relevance: { type: 'string' },
          statements: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'text', 'evidence'],
              properties: {
                kind: {
                  type: 'string',
                  enum: [
                    'indication',
                    'dosage',
                    'contraindication',
                    'warning',
                    'interaction',
                    'pregnancy',
                    'renal',
                    'hepatic',
                    'side_effect',
                    'other',
                  ],
                },
                text: { type: 'string' },
                evidence: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['sourceRef', 'quote'],
                    properties: {
                      sourceRef: { type: 'string' },
                      quote: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    missingInfo: { type: 'array', items: { type: 'string' } },
    dataGaps: { type: 'array', items: { type: 'string' } },
    disclaimer: { type: 'string' },
  },
};

module.exports = { medsAnswerSchema };
