import { stripCitationMarkers } from './citationMarkers';

describe('stripCitationMarkers', () => {
  it('removes markers and the space before them', () => {
    expect(stripCitationMarkers('Fact A. [^1] Fact B.[^12]')).toBe('Fact A. Fact B.');
  });

  it('leaves code alone and ignores look-alikes', () => {
    expect(stripCitationMarkers('Use `[^1]` here.\n```\n[^2]\n```\nReal. [^3]')).toBe(
      'Use `[^1]` here.\n```\n[^2]\n```\nReal.',
    );
    expect(stripCitationMarkers('[^abc] [^1234] [1]')).toBe('[^abc] [^1234] [1]');
  });

  it('returns the input untouched when there is nothing to strip', () => {
    expect(stripCitationMarkers('plain')).toBe('plain');
    expect(stripCitationMarkers('')).toBe('');
  });
});
