import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../test/corpus.js';
import { buildVocabulary, HEADER, MAX_BYTES, vocabularyEntry } from './vocabulary.js';

describe('Transcribe custom vocabulary entries', () => {
  it('keeps what people say and drops company words', () => {
    expect(vocabularyEntry("Graco Children's Products Inc.")).toEqual({
      phrase: "Graco-Children's",
      displayAs: "Graco Children's",
    });
    expect(vocabularyEntry('Chicco')).toEqual({ phrase: 'Chicco', displayAs: 'Chicco' });
    expect(vocabularyEntry('Aitjunz')).toEqual({ phrase: 'Aitjunz', displayAs: 'Aitjunz' });
    expect(vocabularyEntry('Shenzhen Quanyuanfa Trading Co., Ltd. dba Bealife')).toEqual({
      phrase: 'Bealife',
      displayAs: 'Bealife',
    });
    expect(vocabularyEntry('Fisher-Price')).toEqual({
      phrase: 'Fisher-Price',
      displayAs: 'Fisher Price',
    });
    expect(vocabularyEntry("Mercer's")).toEqual({ phrase: "Mercer's", displayAs: "Mercer's" });
    expect(vocabularyEntry('LG Electronics')?.phrase).toBe('L.G.-Electronics');
  });

  it('follows the phrase rules: no digits, spaces or unsupported characters, short entries only', () => {
    expect(vocabularyEntry('3M')).toBeUndefined();
    expect(vocabularyEntry('Model HT-006')).toBeUndefined();
    expect(vocabularyEntry('Huizhou Xiqijun Trading Ltd Electronic Commerce Shop')).toBeUndefined();
    expect(vocabularyEntry('Baby')).toBeUndefined(); // too common to help
    expect(vocabularyEntry('Car')).toBeUndefined();
    expect(vocabularyEntry('Made in China')).toBeUndefined();
    expect(vocabularyEntry('Target, Minneapolis, Minn.')).toEqual({
      phrase: 'Target',
      displayAs: 'Target',
    });
    expect(vocabularyEntry('Café Bistro')).toBeUndefined(); // accented letters are outside the en-US set
  });

  it('builds a valid table from the real corpus, within 50 KB, demo brands first', () => {
    const counts = new Map<string, number>();
    for (const r of loadCorpus()) for (const b of r.brands) counts.set(b, (counts.get(b) ?? 0) + 1);
    const { text, entries } = buildVocabulary(counts, ['Aitjunz', 'Chicco', "Mercer's"]);
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines.slice(1, 4).map((l) => l.split('\t')[0])).toEqual([
      'Aitjunz',
      'Chicco',
      "Mercer's",
    ]);
    expect(entries).toBeGreaterThan(300);
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_BYTES);
    for (const line of lines.slice(1)) {
      const [phrase, soundsLike, ipa, displayAs] = line.split('\t');
      expect(phrase, line).toMatch(/^[A-Za-z][A-Za-z'.-]*$/);
      expect(phrase, line).not.toMatch(/--|''|\.\.|['-]$/);
      expect(soundsLike).toBe('');
      expect(ipa).toBe('');
      expect(displayAs, line).toBeTruthy();
    }
  });
});
