// The letters in the account badge: two for a name with several words, one for
// a single word, read from the address when there is no name.
'use strict';

import { describe, it, expect } from 'vitest';
import { initialsOf } from './initials.js';

describe('initialsOf', () => {
  it('takes the first letter of the first two words of a name', () => {
    expect(initialsOf({ displayName: 'Ashu Sharma' })).toBe('AS');
    expect(initialsOf({ displayName: 'ada lovelace byron' })).toBe('AL');
  });
  it('uses one letter for a single word', () => {
    expect(initialsOf({ displayName: 'Ashu' })).toBe('A');
  });
  it('reads the address before the @ when there is no name, splitting on punctuation', () => {
    expect(initialsOf({ email: 'john.doe@example.com' })).toBe('JD');
    expect(initialsOf({ email: 'mr_m-rashu+dev@gmail.com' })).toBe('MM');
    expect(initialsOf({ email: 'ashu@example.com' })).toBe('A');
  });
  it('prefers the name to the address', () => {
    expect(initialsOf({ displayName: 'Jo Park', email: 'zzz@x.com' })).toBe('JP');
  });
  it('works on any script and never breaks a character in two', () => {
    expect(initialsOf({ displayName: '\u65e5\u672c \u592a\u90ce' })).toBe('\u65e5\u592a');
    expect(initialsOf({ displayName: '\ud83d\ude00 Smile' })).toBe('\ud83d\ude00S');
  });
  it('always returns something', () => {
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf({})).toBe('?');
    expect(initialsOf({ displayName: '  ' })).toBe('?');
  });
});
