import { describe, expect, it } from 'vitest';
import { messageSchema, signupSchema } from '../src/validation.js';

describe('validation', () => {
  it('rejects weak signup passwords', () => {
    expect(() => signupSchema.parse({ name: 'A', email: 'bad', password: '123' })).toThrow();
  });
  it('accepts a valid message', () => {
    const value = messageSchema.parse({ conversationId: 'c1', body: 'Hello' });
    expect(value.body).toBe('Hello');
    expect(value.kind).toBe('text');
  });
  it('rejects an empty message', () => {
    expect(() => messageSchema.parse({ conversationId: 'c1', body: '' })).toThrow();
  });
});
