import { ContentPackage, snapshotFromPackage } from '@de-trainer/core';
import { describe, expect, it } from 'vitest';
import { FIXTURE_MEDIA, demoPackage, ownerPackage } from './index';

const media = new Map(Object.values(FIXTURE_MEDIA).map(({ sha256, mime, bytes, width, height }) => [sha256, { mime, bytes, width, height }]));

describe('fixture packages', () => {
  it('demo package is valid and covers every P0 format and stimulus (A02)', () => {
    const snap = snapshotFromPackage(ContentPackage.parse(demoPackage), media);
    const types = new Set(snap.exercises.map((e) => e.answer_spec.type));
    expect([...types].sort()).toEqual(['choice', 'gaps', 'order']);
    const gaps = snap.exercises.flatMap((e) => (e.answer_spec.type === 'gaps' ? [e.answer_spec.gaps.length] : []));
    expect(gaps.some((n) => n === 1) && gaps.some((n) => n > 1)).toBe(true);
    expect(snap.exercises.some((e) => e.answer_spec.type === 'order' && e.answer_spec.unit === 'line')).toBe(true);
    expect(snap.exercises.some((e) => e.stimulus?.media)).toBe(true);
    expect(snap.exercises.some((e) => e.stimulus?.passage)).toBe(true);
  });

  it('owner test package is valid', () => {
    expect(snapshotFromPackage(ContentPackage.parse(ownerPackage()), media).exercises.length).toBeGreaterThan(5);
  });
});
