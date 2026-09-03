/**
 * Promote User to Admin Script
 * Run this script to promote an existing user to admin role
 * 
 * Usage: pnpm run promote-admin <email>
 */

import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { UserRole } from "../generated/prisma/client.js";

const email = process.argv[2];

async function promoteToAdmin() {
  if (!email) {
    console.error("❌ Please provide an email address");
    console.log("\nUsage: pnpm run promote-admin <email>");
    console.log("Example: pnpm run promote-admin user@example.com");
    process.exit(1);
  }

  try {
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      console.error(`❌ User with email ${email} not found`);
      console.log("\nPlease create an account first at: POST /api/auth/signup");
      process.exit(1);
    }

    if (user.role === UserRole.ADMIN) {
      console.log(`ℹ️  User ${email} is already an admin`);
      process.exit(0);
    }

    // Update to admin
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.ADMIN },
    });

    console.log("\n✅ User promoted to admin successfully!");
    console.log(`   ID: ${updatedUser.id}`);
    console.log(`   Email: ${updatedUser.email}`);
    console.log(`   Name: ${updatedUser.name || "N/A"}`);
    console.log(`   Role: ${updatedUser.role}`);
    console.log("\nThey can now access admin endpoints.");

  } catch (error) {
    console.error("\n❌ Error promoting user:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

promoteToAdmin();
