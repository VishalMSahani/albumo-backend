/**
 * Backfill component slugs
 * Run AFTER prisma migrate dev to populate slug for all existing components
 */

import { prisma } from "../lib/prisma.js";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

async function backfillSlugs() {
  console.log("🔄 Starting component slug backfill...");

  const components = await prisma.component.findMany({
    select: { id: true, name: true, slug: true },
  });

  console.log(`📦 Found ${components.length} components to process`);

  let updated = 0;
  let skipped = 0;

  for (const component of components) {
    // Skip if already has a non-empty slug
    if (component.slug && component.slug.length > 0) {
      skipped++;
      continue;
    }

    const baseSlug = generateSlug(component.name);
    let slug = baseSlug;
    let attempt = 1;

    // Handle collisions — append -2, -3, etc.
    while (true) {
      const existing = await prisma.component.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!existing || existing.id === component.id) {
        break; // Slug is available
      }

      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    await prisma.component.update({
      where: { id: component.id },
      data: { slug },
    });

    console.log(`  ✅ ${component.name} → ${slug}`);
    updated++;
  }

  console.log(`\n✨ Done! Updated: ${updated}, Skipped (already had slug): ${skipped}`);
  await prisma.$disconnect();
}

backfillSlugs().catch((err) => {
  console.error("❌ Error during backfill:", err);
  process.exit(1);
});
