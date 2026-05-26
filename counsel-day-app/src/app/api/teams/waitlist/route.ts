/**
 * POST /api/teams/waitlist
 *
 * Counsel · Teams waitlist signup. Public endpoint (no auth required ·
 * leads come from cold outreach + landing-page traffic before they
 * have an account). Rate-limited by IP + email. Successful signups
 * fire a Slack-style notification to OPS_DIGEST_EMAIL so the operator
 * can follow up the same day.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { sendTransactional } from '@/lib/email';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  full_name: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().min(1).max(160).optional(),
  role: z.string().trim().max(120).optional(),
  team_size: z.enum(['1-5', '5-25', '25-100', '100-500', '500+']).optional(),
  country: z.string().trim().max(60).optional(),
  source: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  // Rate-limit · 5 per IP per hour, 3 per email per hour.
  const ipRl = await checkRateLimit(`teams-waitlist-ip:${ip}`, 5, 3600);
  if (!ipRl.allowed) return rateLimitResponse(ipRl, 'Too many waitlist signups from this network.');

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'A valid email is required.' }, { status: 422 });
  }
  const d = parsed.data;

  const emailRl = await checkRateLimit(`teams-waitlist-email:${d.email}`, 3, 3600);
  if (!emailRl.allowed) return rateLimitResponse(emailRl, 'You already signed up; we will email you shortly.');

  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 400);
  const ipHash = ip ? createHash('sha256').update(ip + 'cd-salt').digest('hex').slice(0, 32) : null;

  await db.insert(schema.teamsWaitlist).values({
    email: d.email,
    fullName: d.full_name ?? null,
    company: d.company ?? null,
    role: d.role ?? null,
    teamSize: d.team_size ?? null,
    country: d.country ?? null,
    source: d.source ?? null,
    notes: d.notes ?? null,
    userAgent,
    ipHash,
  });

  // Fire-and-forget ops alert · the operator gets a same-day nudge to
  // follow up. Don't fail the signup if email is unavailable.
  const opsEmail = process.env.OPS_DIGEST_EMAIL;
  if (opsEmail) {
    void sendTransactional({
      to: { email: opsEmail, name: 'Counsel.day operator' },
      subject: '[Counsel · Teams] new waitlist signup · ' + (d.company || d.email),
      textContent: [
        'New Counsel · Teams waitlist signup.',
        '',
        'Email:    ' + d.email,
        'Name:     ' + (d.full_name || '·'),
        'Company:  ' + (d.company || '·'),
        'Role:     ' + (d.role || '·'),
        'Team:     ' + (d.team_size || '·'),
        'Country:  ' + (d.country || '·'),
        'Source:   ' + (d.source || '·'),
        'Notes:    ' + (d.notes || '·'),
        '',
        'Review at https://counsel.day/admin.html',
      ].join('\n'),
      htmlContent:
        '<h3 style="font-family: Newsreader, Georgia, serif;">New Counsel &middot; Teams waitlist signup</h3>' +
        '<p><strong>' + escape(d.company || d.email) + '</strong></p>' +
        '<table style="font-family: Georgia, serif; border-collapse: collapse;">' +
        ['email','full_name','company','role','team_size','country','source','notes'].map(function (k) {
          const v = (d as Record<string, string | undefined>)[k];
          return '<tr><td style="padding: 4px 12px; color: #6b635a;">' + k + '</td><td style="padding: 4px 12px;"><strong>' + escape(v || '·') + '</strong></td></tr>';
        }).join('') +
        '</table>',
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, message: "You're on the list. We'll be in touch shortly." }, { status: 201 });
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
