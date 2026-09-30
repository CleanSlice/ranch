import { describe, expect, test } from 'bun:test';
import {
  agentsLabel,
  cpuLabel,
  cpuMilli,
  imageTag,
  memoryLabel,
  memoryMi,
  resourceShare,
  templateHue,
  templateInitials,
} from './templateFormat';

describe('templateInitials', () => {
  test('first letters of the first two words', () => {
    expect(templateInitials('Dreamvention Support Agent')).toBe('DS');
    expect(templateInitials('GitHub Manager')).toBe('GM');
  });

  test('one word gives one letter, upper-cased', () => {
    expect(templateInitials('coder')).toBe('C');
  });

  test('skips words that do not start with a letter', () => {
    expect(templateInitials('42 things — Bonsite')).toBe('TB');
  });

  test('empty name falls back to a placeholder', () => {
    expect(templateInitials('')).toBe('?');
    expect(templateInitials('   ')).toBe('?');
  });
});

describe('templateHue', () => {
  test('is stable for the same id and within the colour wheel', () => {
    const a = templateHue('rancher');
    expect(a).toBe(templateHue('rancher'));
    expect(a >= 0 && a < 360).toBe(true);
  });

  test('different ids spread out', () => {
    expect(templateHue('coder')).not.toBe(templateHue('default'));
  });
});

describe('cpuMilli / cpuLabel', () => {
  test('parses Kubernetes cpu quantities', () => {
    expect(cpuMilli('2000m')).toBe(2000);
    expect(cpuMilli('500m')).toBe(500);
    expect(cpuMilli('2')).toBe(2000);
    expect(cpuMilli('0.5')).toBe(500);
  });

  test('unreadable cpu is zero', () => {
    expect(cpuMilli('')).toBe(0);
    expect(cpuMilli('lots')).toBe(0);
  });

  test('labels in vCPU without trailing zeros', () => {
    expect(cpuLabel('2000m')).toBe('2 vCPU');
    expect(cpuLabel('500m')).toBe('0.5 vCPU');
    expect(cpuLabel('250m')).toBe('0.25 vCPU');
    expect(cpuLabel('')).toBe('— vCPU');
  });
});

describe('memoryMi / memoryLabel', () => {
  test('parses Kubernetes memory quantities into MiB', () => {
    expect(memoryMi('2Gi')).toBe(2048);
    expect(memoryMi('512Mi')).toBe(512);
    expect(memoryMi('1G')).toBe(1000000000 / 1048576);
    expect(memoryMi('1024Ki')).toBe(1);
    expect(memoryMi('1048576')).toBe(1);
  });

  test('unreadable memory is zero', () => {
    expect(memoryMi('')).toBe(0);
    expect(memoryMi('big')).toBe(0);
  });

  test('labels in GiB from 1024 MiB up, MiB below', () => {
    expect(memoryLabel('2Gi')).toBe('2 GiB');
    expect(memoryLabel('1536Mi')).toBe('1.5 GiB');
    expect(memoryLabel('512Mi')).toBe('512 MiB');
    expect(memoryLabel('')).toBe('— MiB');
  });
});

describe('resourceShare', () => {
  test('share of the reference limit, capped at 100', () => {
    expect(resourceShare(2000, 4000)).toBe(50);
    expect(resourceShare(8000, 4000)).toBe(100);
    expect(resourceShare(0, 4000)).toBe(0);
  });

  test('no reference → no bar', () => {
    expect(resourceShare(2000, 0)).toBe(0);
  });
});

describe('agentsLabel', () => {
  test('counts running agents in words', () => {
    expect(agentsLabel(0)).toBe('No agents running');
    expect(agentsLabel(1)).toBe('1 agent running');
    expect(agentsLabel(4)).toBe('4 agents running');
  });
});

describe('imageTag', () => {
  test('keeps the last path segment with its tag', () => {
    expect(imageTag('ghcr.io/cleanslice/runtime:latest')).toBe('runtime:latest');
    expect(imageTag('runtime')).toBe('runtime');
    expect(imageTag('')).toBe('');
  });
});
