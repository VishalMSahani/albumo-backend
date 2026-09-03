/**
 * Update Component Images
 * Updates all components to use the Pixabay Arduino image
 */

import "dotenv/config";
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const pixabayImageUrl = 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png';

async function updateComponentImages() {
  console.log('🖼️  Updating component images...');

  try {
    const result = await prisma.component.updateMany({
      data: {
        imageUrl: pixabayImageUrl,
      },
    });

    console.log(`✅ Updated ${result.count} components with new image URL`);
    console.log('✨ Update complete!');
  } catch (error) {
    console.error('❌ Error updating components:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateComponentImages();
