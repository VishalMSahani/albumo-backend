import { prisma } from "../../../lib/prisma.js";
import { NotFoundError, ConflictError } from "../../../utils/types.js";
import type {
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateSubcategoryRequest,
  UpdateSubcategoryRequest,
} from "../types/category.types.js";

export async function getAllCategories() {
  return prisma.category.findMany({
    include: {
      subcategories: true,
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

  const updateData: any = { ...data };
  if (updateData.imageUrl === "") {
    updateData.imageUrl = null;
  }
  if (updateData.description === "") {
    updateData.description = null;
  }

  return prisma.category.update({
    where: { id },
    data: updateData,
    include: {
      subcategories: true,
    },
  });
}

export async function deleteCategory(id: string) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Category not found");
  }

  // Update components referencing this category to defaults
  await prisma.component.updateMany({
    where: { category: { equals: existing.name, mode: "insensitive" } },
    data: {
      category: "Electronics Components",
      subcategory: "General",
    },
  });

  await prisma.category.delete({ where: { id } });
  return { message: "Category deleted" };
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
    },
  });
}

export async function updateSubcategory(id: string, data: UpdateSubcategoryRequest) {
  const existing = await prisma.subcategory.findUnique({ where: { id } });
  if (!existing) {
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
      throw new ConflictError(`Subcategory "${data.name}" already exists in this category`);
    }
  }

  return prisma.subcategory.update({
    where: { id },
    data,
  });
}

export async function deleteSubcategory(id: string) {
  const existing = await prisma.subcategory.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Subcategory not found");
  }

  // Update components referencing this subcategory to defaults
  await prisma.component.updateMany({
    where: { subcategory: { equals: existing.name, mode: "insensitive" } },
    data: {
      subcategory: "General",
    },
  });

  await prisma.subcategory.delete({ where: { id } });
  return { message: "Subcategory deleted" };
}
