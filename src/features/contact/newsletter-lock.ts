import type { Prisma } from "../../generated/prisma/client.js";

export async function acquireNewsletterLock(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  email: string,
): Promise<void> {
  // PostgreSQL returns void here. Execute for its locking side effect rather
  // than asking Prisma to deserialize an unsupported result column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`newsletter:${email}`}))`;
}
