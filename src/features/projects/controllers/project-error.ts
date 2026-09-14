import type { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';

export function projectError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    res.status(error.code === 'P2002' ? 409 : 400).json({ success: false, error: error.code === 'P2002' ? 'This project slug or a component entry already exists.' : error.code === 'P2003' || error.code === 'P2025' ? 'A referenced component or project does not exist. Check the catalogue IDs.' : 'The project could not be saved. Check its fields and try again.' });
    return;
  }
  const message = error instanceof Error ? error.message : '';
  const status = message === 'Project not found' ? 404 : message.includes('already exists') ? 409 : /invalid JSON|Provide a URL slug|must be|Maximum|upload failed|replaceImages|replacePdfs|replaceLinks/.test(message) ? 400 : 500;
  res.status(status).json({ success: false, error: status === 500 ? 'The project could not be saved. Please try again.' : message });
}
