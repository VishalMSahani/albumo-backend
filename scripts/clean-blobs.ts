import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const badComponents = await prisma.component.findMany({
    where: { imageUrl: { startsWith: 'blob:' } }
  });
  console.log(`Found ${badComponents.length} components with blob: urls`);
  for (const c of badComponents) {
    await prisma.component.update({
      where: { id: c.id },
      data: { imageUrl: null }
    });
  }
  console.log("Cleaned up bad URLs");
}
run().finally(() => prisma.$disconnect());
