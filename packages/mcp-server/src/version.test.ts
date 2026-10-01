import { describe, expect, it } from 'vitest';
import { SERVER_NAME } from './version.js';

describe('version', () => {
  it('exposes the server name', () => {
    expect(SERVER_NAME).toBe('recall-guardian');
  });
});
