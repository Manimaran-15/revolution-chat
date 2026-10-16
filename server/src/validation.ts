import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(128)
});
export const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) });
export const messageSchema = z.object({ conversationId: z.string().min(1).max(80), body: z.string().trim().max(4000), kind: z.enum(['text','image','video','file','voice']).default('text'), attachmentUrl: z.string().max(500).optional(), attachmentName: z.string().max(255).optional(), attachmentType: z.string().max(120).optional(), attachmentSize: z.number().int().nonnegative().max(500 * 1024 * 1024).optional() }).refine(v => v.body.length > 0 || !!v.attachmentUrl, 'Message must contain text or an attachment');
export const groupSchema = z.object({ title: z.string().trim().min(2).max(80), memberIds: z.array(z.string().min(1)).min(1).max(50) });
export const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(8) });
export const profileSchema = z.object({ name: z.string().trim().min(2).max(60), bio: z.string().max(160) });

export const deleteAccountSchema = z.object({ password: z.string().min(1, 'Enter your password to confirm') });
