import { prisma } from "../../../lib/prisma.js";

export type AddressInput = {
  name: string;
  phone: string;
  line1: string;
  line2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
  country?: string | undefined;
  isDefault?: boolean;
};

function cleanAddressInput(input: AddressInput) {
  return {
    name: input.name.trim(),
    phone: input.phone.trim(),
    line1: input.line1.trim(),
    line2: input.line2?.trim() || null,
    city: input.city.trim(),
    state: input.state.trim(),
    pincode: input.pincode.trim(),
    country: input.country?.trim() || "India",
    isDefault: Boolean(input.isDefault),
  };
}

export function assertAddressInput(input: AddressInput) {
  const fields: Array<"name" | "phone" | "line1" | "city" | "state" | "pincode"> = [
    "name",
    "phone",
    "line1",
    "city",
    "state",
    "pincode",
  ];

  for (const field of fields) {
    if (!input[field]?.trim()) {
      throw new Error(`Address ${field} is required`);
    }
  }

  if (!/^[0-9]{6}$/.test(input.pincode.trim())) {
    throw new Error("Pincode must be 6 digits");
  }
}

export async function listUserAddresses(userId: string) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function createUserAddress(userId: string, input: AddressInput) {
  assertAddressInput(input);
  const data = cleanAddressInput(input);

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const addressCount = await tx.address.count({ where: { userId } });

    return tx.address.create({
      data: {
        ...data,
        isDefault: data.isDefault || addressCount === 0,
        userId,
      },
    });
  });
}

export async function updateUserAddress(userId: string, addressId: string, input: AddressInput) {
  assertAddressInput(input);
  const data = cleanAddressInput(input);

  return prisma.$transaction(async (tx) => {
    const existingAddress = await tx.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existingAddress) {
      throw new Error("Address not found");
    }

    if (data.isDefault) {
      await tx.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    return tx.address.update({
      where: { id: addressId },
      data,
    });
  });
}

export async function setDefaultUserAddress(userId: string, addressId: string) {
  return prisma.$transaction(async (tx) => {
    const existingAddress = await tx.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existingAddress) {
      throw new Error("Address not found");
    }

    await tx.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    return tx.address.update({
      where: { id: addressId },
      data: { isDefault: true },
    });
  });
}

export async function deleteUserAddress(userId: string, addressId: string) {
  const existingAddress = await prisma.address.findFirst({
    where: {
      id: addressId,
      userId,
    },
  });

  if (!existingAddress) {
    throw new Error("Address not found");
  }

  return prisma.address.delete({
    where: { id: addressId },
  });
}
