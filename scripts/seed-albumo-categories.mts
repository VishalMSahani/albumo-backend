import { prisma } from "../src/lib/prisma.js";
import { emptyConfiguration } from "../src/features/components/types/catalogue.js";
const families = [
  {
    name: "Photo Albums",
    description: "Photo books and albums for the stories you want to keep.",
    format: "album",
    children: ["Travel Books", "Wedding Albums", "Birthday Albums", "Everyday Stories"],
  },
  {
    name: "Wall Art",
    description: "Turn favourite photographs into pieces for your space.",
    format: "print",
    children: ["Canvas Prints", "Framed Prints", "Acrylic Prints"],
  },
  {
    name: "Gifts",
    description: "Personal keepsakes for people and moments that matter.",
    format: "gift",
    children: ["Photo Mugs", "Photo Cushions", "Calendars", "Small Keepsakes"],
  },
] as const;
try {
  await prisma.$transaction(async (tx) => {
    for (const family of families) {
      const category = await tx.category.upsert({
        where: { name: family.name },
        update: {},
        create: { name: family.name, description: family.description },
      });
      for (const name of family.children)
        await tx.subcategory.upsert({
          where: { categoryId_name: { categoryId: category.id, name } },
          update: {},
          create: {
            categoryId: category.id,
            name,
            configuration: { ...emptyConfiguration, format: family.format },
          },
        });
    }
  });
  console.log(
    "Albumo category structure is ready. Existing records were preserved; no products were published.",
  );
} finally {
  await prisma.$disconnect();
}
