import { prisma } from "../src/lib/prisma.js";
import { referenceProduct } from "../src/features/components/data/reference-products.js";
import { emptyConfiguration } from "../src/features/components/types/catalogue.js";
import { configurationSchema } from "../src/features/components/validators/catalogue.js";

const apply = process.argv.includes("--apply");
try {
  const categories = await prisma.subcategory.findMany({
    include: { category: true },
    orderBy: [{ categoryId: "asc" }, { name: "asc" }],
  });
  if (!categories.length)
    throw new Error("Create the Albumo categories first.");
  let created = 0,
    skipped = 0,
    presets = 0;
  for (const category of categories) {
    const data = referenceProduct(category);
    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.component.findUnique({
          where: { sku: data.sku },
        });
        if (existing) return { created: false, preset: false };
        const parsed = configurationSchema.safeParse(category.configuration);
        const untouchedPreset =
          !category.configuration ||
          (parsed.success &&
            JSON.stringify(parsed.data) ===
              JSON.stringify(
                configurationSchema.parse({
                  ...emptyConfiguration,
                  format: parsed.data.format,
                }),
              ));
        if (apply) {
          await tx.component.create({ data });
          if (untouchedPreset)
            await tx.subcategory.update({
              where: { id: category.id },
              data: { configuration: data.configuration },
            });
        }
        return { created: true, preset: untouchedPreset };
      },
      { timeout: 15000 },
    );
    if (result.created) created++;
    else skipped++;
    if (result.preset) presets++;
    console.log(
      JSON.stringify({
        category: category.name,
        product: data.name,
        status: result.created
          ? apply
            ? "created-draft"
            : "would-create-draft"
          : "preserved-existing",
        optionGroups: data.configuration.groups.length,
      }),
    );
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      created,
      skipped,
      emptyPresetsFilled: presets,
      published: 0,
    }),
  );
} catch (error) {
  // Database connection errors can contain connection details; never print credentials.
  console.error(
    error instanceof Error &&
      !/prisma|database|connection|authentication/i.test(error.message)
      ? error.message
      : "Reference seeding failed. Check database connectivity and migrations.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
