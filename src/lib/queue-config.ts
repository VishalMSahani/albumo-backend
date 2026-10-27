// Keep this Albumo backend independent when a copied Redis connection is used.
export const queuePrefix = process.env.BULLMQ_PREFIX?.trim() || "albumo";
