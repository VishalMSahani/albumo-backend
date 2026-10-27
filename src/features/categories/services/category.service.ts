import { prisma } from "../../../lib/prisma.js";
import { NotFoundError, ConflictError } from "../../../utils/types.js";
import type {
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateSubcategoryRequest,
  UpdateSubcategoryRequest,
} from "../types/category.types.js";

export async function getAllCategories(includeInactive = false) {
  return prisma.category.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: {
      subcategories: {
        where: includeInactive ? {} : { isActive: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function createCategory(data: CreateCategoryRequest) {
  const existing = await prisma.category.findUnique({
    where: { name: data.name },
  });

  if (existing) {
    throw new ConflictError(`Category "${data.name}" already exists`);
  }

  return prisma.category.create({
    data: {
      name: data.name,
      description: data.description || null,
      imageUrl: data.imageUrl || null,
      isActive: data.isActive !== undefined ? data.isActive : true,
    },
    include: {
      subcategories: true,
    },
  });
}

export async function updateCategory(id: string, data: UpdateCategoryRequest) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Category not found");
  }

  if (data.name && data.name !== existing.name) {
    const nameExists = await prisma.category.findUnique({
      where: { name: data.name },
    });
    if (nameExists) {
      throw new ConflictError(`Category "${data.name}" already exists`);
    }
  }

  const updateData = {
    ...data,
    ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl || null } : {}),
    ...(data.description !== undefined ? { description: data.description || null } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.update({
      where: { id },
      data: updateData,
      include: { subcategories: true },
    });
    if (data.name && data.name !== existing.name) {
      await tx.component.updateMany({
        where: { category: { equals: existing.name, mode: "insensitive" } },
        data: { category: data.name },
      });
    }
    return category;
  });
}

export async function deleteCategory(id: string) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Category not found");
  }

  return prisma.$transaction(async (tx) => {
    const assigned = await tx.component.count({
      where: { category: { equals: existing.name, mode: "insensitive" } },
    });
    if (assigned)
      throw new ConflictError(
        "Move all products to another category before deleting this category",
      );
    await tx.category.delete({ where: { id } });
    return { message: "Category deleted" };
  });
}

export async function createSubcategory(data: CreateSubcategoryRequest) {
  const category = await prisma.category.findUnique({
    where: { id: data.categoryId },
  });
  if (!category) {
    throw new NotFoundError("Category not found");
  }

  const existing = await prisma.subcategory.findUnique({
    where: {
      categoryId_name: {
        categoryId: data.categoryId,
        name: data.name,
      },
    },
  });

  if (existing) {
    throw new ConflictError(`Subcategory "${data.name}" already exists in this category`);
  }

  return prisma.subcategory.create({
    data: {
      categoryId: data.categoryId,
      name: data.name,
      description: data.description || null,
      imageUrl: data.imageUrl || null,
      isActive: data.isActive !== undefined ? data.isActive : true,
      ...(data.configuration ? { configuration: data.configuration } : {}),
    },
  });
}

export async function updateSubcategory(
  id: string,
  data: UpdateSubcategoryRequest,
  categoryId?: string,
) {
  const existing = await prisma.subcategory.findUnique({ where: { id } });
  if (!existing || (categoryId && existing.categoryId !== categoryId)) {
    throw new NotFoundError("Subcategory not found");
  }

  if (data.name && data.name !== existing.name) {
    const nameExists = await prisma.subcategory.findUnique({
      where: {
        categoryId_name: {
          categoryId: existing.categoryId,
          name: data.name,
        },
      },
    });
    if (nameExists) {
      throw new ConflictError(
        `Subcategory "${data.name}" already exists in this category`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const parent = await tx.category.findUniqueOrThrow({
      where: { id: existing.categoryId },
    });
    const subcategory = await tx.subcategory.update({ where: { id }, data });
    if (data.name && data.name !== existing.name) {
      await tx.component.updateMany({
        where: {
          category: { equals: parent.name, mode: "insensitive" },
          subcategory: { equals: existing.name, mode: "insensitive" },
        },
        data: { subcategory: data.name },
      });
    }
    return subcategory;
  });
}

export async function deleteSubcategory(id: string, categoryId?: string) {
  const existing = await prisma.subcategory.findUnique({ where: { id } });
  if (!existing || (categoryId && existing.categoryId !== categoryId)) {
    throw new NotFoundError("Subcategory not found");
  }

  return prisma.$transaction(async (tx) => {
    const parent = await tx.category.findUniqueOrThrow({
      where: { id: existing.categoryId },
    });
    const assigned = await tx.component.count({
      where: {
        category: { equals: parent.name, mode: "insensitive" },
        subcategory: { equals: existing.name, mode: "insensitive" },
      },
    });
    if (assigned)
      throw new ConflictError(
        "Move all products to another subcategory before deleting this subcategory",
      );
    await tx.subcategory.delete({ where: { id } });
    return { message: "Subcategory deleted" };
  });
}
