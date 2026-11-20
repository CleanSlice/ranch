import { ALLOWED_MIME_TYPES } from '#/bridle/domain/attachment.constants';
import {
  attachmentsForVisitor,
  describeForVisitor,
  kindOf,
  limitsForVisitor,
  skillsForVisitor,
} from './shareAgentInfo';

describe('describeForVisitor', () => {
  it('prefers the agent, falls back to the template, then to nothing', () => {
    expect(describeForVisitor({ description: ' Own ' }, 'Tpl')).toBe('Own');
    expect(describeForVisitor({ description: '   ' }, ' Tpl ')).toBe('Tpl');
    expect(describeForVisitor({ description: 42 }, '')).toBeNull();
    expect(describeForVisitor(null, undefined)).toBeNull();
  });

  it('cuts at 500 characters', () => {
    expect(
      describeForVisitor({ description: 'x'.repeat(600) }, null),
    ).toHaveLength(500);
  });
});

describe('skillsForVisitor', () => {
  it('keeps title and description only and drops blank titles', () => {
    const out = skillsForVisitor([
      {
        id: 's1',
        title: ' Orders ',
        description: ' Tracks orders ',
        body: 'SECRET',
        source: 'https://x',
      },
      { id: 's2', title: '  ', description: 'x' },
      { id: 's3', title: 'FAQ', description: '  ' },
    ] as never);
    expect(out).toEqual([
      { title: 'Orders', description: 'Tracks orders' },
      { title: 'FAQ', description: null },
    ]);
  });
});

describe('limitsForVisitor', () => {
  it('is null without a row or with every window null', () => {
    expect(limitsForVisitor(null)).toBeNull();
    expect(
      limitsForVisitor({ perMinute: null, perHour: null, perDay: null }),
    ).toBeNull();
  });

  it('carries exactly the three configured values', () => {
    const src = {
      perMinute: null,
      perHour: 20,
      perDay: 100,
      updatedById: 'u1',
    };
    expect(limitsForVisitor(src as never)).toEqual({
      perMinute: null,
      perHour: 20,
      perDay: 100,
    });
  });
});

describe('attachmentsForVisitor', () => {
  it('reports the server constants and every accepted family', () => {
    expect(attachmentsForVisitor()).toEqual({
      maxPerMessage: 5,
      maxFileBytes: 10 * 1024 * 1024,
      maxMessageBytes: 25 * 1024 * 1024,
      kinds: ['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text'],
    });
  });

  // A MIME type added to ALLOWED_MIME_TYPES without a family fails here
  // instead of silently going unadvertised.
  it('has a family for every accepted MIME type', () => {
    for (const mime of ALLOWED_MIME_TYPES) expect(kindOf(mime)).not.toBeNull();
  });
});
