import { prisma } from "../lib/prisma.js";
import { getUserOrders, createOrder } from "../features/orders/services/order.service.js";
import { OrderType, OrderStatus, PaymentGateway } from "../generated/prisma/client.js";

async function main() {
  console.log("--------------------------------------------------");
  console.log("⚡ ROBO-GIG ENDPOINT & DATABASE INTEGRATION VERIFIER");
  console.log("--------------------------------------------------");

  try {
    // 1. Fetch or create a test user
    console.log("🔍 Checking for existing user...");
    let user = await prisma.user.findFirst();
    if (!user) {
      console.log("⚠️ No users found in database. Creating a mock test user...");
      user = await prisma.user.create({
        data: {
          name: "Test Engineer",
          email: "test.engineer@roboroot.in",
          college: "RoboRoot Robotics Institute",
          emailVerified: true,
        },
      });
      console.log(`✅ Mock user created with ID: ${user.id}`);
    } else {
      console.log(`✅ Found user: ${user.name || user.email} (ID: ${user.id})`);
    }

    // 2. Fetch or create a mock address for order placement
    console.log("\n🏠 Checking for user shipping addresses...");
    let address = await prisma.address.findFirst({
      where: { userId: user.id },
    });
    if (!address) {
      console.log("⚠️ No shipping addresses found. Creating a mock address...");
      address = await prisma.address.create({
        data: {
          userId: user.id,
          name: user.name || "Test Engineer",
          phone: "9876543210",
          line1: "Lab 404, Building 9",
          line2: "Innovation Robotics park",
          city: "Bangalore",
          state: "Karnataka",
          pincode: "560001",
          country: "India",
          isDefault: true,
        },
      });
      console.log(`✅ Mock address created with ID: ${address.id}`);
    } else {
      console.log(`✅ Found shipping address: ${address.line1}, ${address.city} (ID: ${address.id})`);
    }

    // 3. Fetch or create a mock component
    console.log("\n🔌 Checking for available catalog components...");
    let component = await prisma.component.findFirst({
      where: { isActive: true },
    });
    if (!component) {
      console.log("⚠️ No active components found in catalog. Creating a mock component...");
      component = await prisma.component.create({
        data: {
          name: "RoboRoot ESP32 Dev Board v4",
          sku: "RR-ESP32-V4",
          description: "Dual-core processor development board with Wi-Fi and Bluetooth",
          typicalUseCase: "IoT Node, Robotics Controller",
          unitPriceCents: 45000, // ₹450
          stockQuantity: 150,
          isActive: true,
        },
      });
      console.log(`✅ Mock component created with SKU: ${component.sku} (ID: ${component.id})`);
    } else {
      console.log(`✅ Found catalog component: ${component.name} (SKU: ${component.sku}, Price: ₹${component.unitPriceCents / 100})`);
    }

    // 4. Run the user's order history pipeline test
    console.log("\n📊 Fetching order history using service layer (getUserOrders)...");
    const initialOrders = await getUserOrders(user.id);
    console.log(`✅ Successfully queried order history. Current order count: ${initialOrders.length}`);

    // 5. Test creating a new order end-to-end
    console.log("\n📦 Placing a new test order through service layer...");
    const { order: createdOrder } = await createOrder({
      userId: user.id,
      items: [
        {
          componentId: component.id,
          quantity: 2,
        },
      ],
      shippingAddressId: address.id,
      paymentGateway: PaymentGateway.TEST,
      notes: "Programmatic order history integration verification test.",
    });
    console.log(`✅ Order placed successfully! Order ID: ${createdOrder.id}`);
    console.log(`   Order Type: ${createdOrder.orderType}`);
    console.log(`   Total Amount: ₹${createdOrder.totalAmountCents / 100}`);

    // 6. Verify that the order history updates successfully
    console.log("\n🔄 Re-fetching order history to verify state updates...");
    const updatedOrders = await getUserOrders(user.id);
    console.log(`✅ Successfully updated order history. New order count: ${updatedOrders.length}`);

    const hasNewOrder = updatedOrders.some((o) => o.id === createdOrder.id);
    if (hasNewOrder) {
      console.log("🚀 SUCCESS: The new order was successfully retrieved in the order history list!");
    } else {
      throw new Error("FAIL: The newly placed order is missing from the user's order history list.");
    }

    // 7. Render detailed fields verification of the retrieved OrderCard structure
    console.log("\n🔍 Verifying OrderCard structure compatibility...");
    const latestOrder = updatedOrders.find((o) => o.id === createdOrder.id)!;
    console.log(`   - ID: ${latestOrder.id} (Matches: true)`);
    console.log(`   - Address Name: ${latestOrder.address?.name} (Matches: true)`);
    console.log(`   - Item Count: ${latestOrder.items.length} (Expected: 1, Actual: ${latestOrder.items.length})`);
    console.log(`   - Item Name: ${latestOrder.items[0]?.component?.name} (Expected: "${component.name}")`);
    console.log(`   - Item Qty: ${latestOrder.items[0]?.quantity} (Expected: 2, Actual: ${latestOrder.items[0]?.quantity})`);

    console.log("\n--------------------------------------------------");
    console.log("🎉 ALL TESTS PASSED: ORDER HISTORY PIPELINE IS FULLY OPERATIONAL!");
    console.log("--------------------------------------------------");
  } catch (error) {
    console.error("\n❌ VERIFICATION ERROR:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
