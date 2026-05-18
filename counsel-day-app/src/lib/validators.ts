import { z } from 'zod';

export const signupSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .max(80, 'First name must be 80 characters or fewer'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please enter a valid email address')
    .max(200, 'Email must be 200 characters or fewer'),
  decision_kind: z
    .enum(['solo', 'couple', 'family', 'exploring', ''])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  marketing_consent: z
    .union([z.literal('yes'), z.literal('on'), z.literal(''), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'yes' || v === 'on'),
  g_recaptcha_token: z.string().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
