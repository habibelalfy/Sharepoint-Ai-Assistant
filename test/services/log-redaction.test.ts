import { describe, expect, it } from '@jest/globals';
import { redactSecrets } from '../../src/services/log-redaction';

describe('redactSecrets', () => {
  it('masks sensitive keys recursively', () => {
    expect(redactSecrets({ password: 'x', nested: { token: 'y', safe: 'z' } })).toEqual({
      password: '[REDACTED]',
      nested: { token: '[REDACTED]', safe: 'z' },
    });
  });

  it('leaves non-sensitive data untouched', () => {
    expect(redactSecrets({ listName: 'Projects', count: 3, tags: ['a', 'b'] })).toEqual({
      listName: 'Projects',
      count: 3,
      tags: ['a', 'b'],
    });
  });
});
