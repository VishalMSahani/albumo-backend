/**
 * Bootstrap Script - Create First Admin User
 * Run this script ONCE to create your first admin account
 * 
 * Usage: pnpm run bootstrap
 */

import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../utils/password.js";
import { UserRole } from "../generated/prisma/client.js";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function createFirstAdmin() {
  console.log("\n🚀 BuildWise Bootstrap - Create First Admin\n");

  try {
    // Check if any admin already exists
    const existingAdmin = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
    });

    if (existingAdmin) {
      console.log("⚠️  An admin user already exists:");
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Name: ${existingAdmin.name || "N/A"}`);
      console.log("\nUse the /api/admin/promote endpoint to create more admins.");
      rl.close();
      return;
    }

    // Get admin details
    const email = await question("Enter admin email: ");
    const password = await question("Enter admin password (min 8 chars): ");
    const name = await question("Enter admin name (optional): ");

    // Validate
    if (!email || !email.includes("@")) {
      console.error("❌ Invalid email address");
      rl.close();
      return;
    }

    if (!password || password.length < 8) {
      console.error("❌ Password must be at least 8 characters");
      rl.close();
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      console.error(`❌ User with email ${email} already exists`);
      console.log("\nYou can promote this user to admin using:");
      console.log(`pnpm run promote-admin ${email}`);
      rl.close();
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create admin user
    const admin = await prisma.$transaction(async (tx) => {
      const newAdmin = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          name: name.trim() || null,
          role: UserRole.ADMIN,
          isActive: true,
        },
      });

      await tx.emailCredential.create({
        data: {
          userId: newAdmin.id,
          passwordHash,
        },
      });

      return newAdmin;
    });

    console.log("\n✅ Admin user created successfully!");
    console.log(`   ID: ${admin.id}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Name: ${admin.name || "N/A"}`);
    console.log(`   Role: ${admin.role}`);
    console.log("\nYou can now login at: POST /api/auth/login");
    console.log("\nTo create more admins, use the /api/admin/promote endpoint");

  } catch (error) {
    console.error("\n❌ Error creating admin:", error);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

createFirstAdmin();
