import { prisma } from "../../lib/prisma.js";
import { configurationSchema } from "../components/validators/catalogue.js";
import { StudioProjectError } from "./error.js";

import type { StudioSelection } from "./selection.schema.js";
export { selectionSchema } from "./selection.schema.js";
export function photoRequirement(pages: number) {
  return {
    minimumPhotos: Math.ceil(pages * 1.2),
    recommendedPhotos: Math.ceil(pages * 1.3),
  };
}
export function resolveConfiguration(
  product: { id: string; name: string; configuration: unknown },
  input: StudioSelection,
) {
  const config = configurationSchema.parse(product.configuration);
  const invalid = (message: string): never => {
    throw new StudioProjectError(422, "STUDIO_CONFIGURATION_INVALID", message);
  };
  if (!["album", "book"].includes(config.format) || !config.allowPhotoUpload)
    invalid("This product is not available for Studio design.");
  for (const key of Object.keys(input.choices))
    if (!config.groups.some((group) => group.id === key))
      invalid("An option is no longer available. Choose your options again.");
  const options = config.groups.flatMap((group) => {
    const id = input.choices[group.id];
    if (!id && !group.required) return [];
    const option = group.options.find((choice) => choice.id === id);
    if (!option)
      return invalid(`Choose an available ${group.label.toLowerCase()}.`);
    return [
      {
        groupId: group.id,
        kind: group.kind,
        label: group.label,
        choiceId: option.id,
        value: option.label,
        ...(option.width
          ? { width: option.width, height: option.height!, unit: option.unit! }
          : {}),
      },
    ];
  });
  for (const kind of ["dimension", "cover", "pages"])
    if (!options.some((option) => option.kind === kind))
      invalid(
        `This album needs a configured ${kind} option before design can start.`,
      );
  const pageChoice = options.find((option) => option.kind === "pages")!;
  // Existing catalogue choices use explicit labels such as "20 pages".
  const pageCount = Number(/^(\d+)\s+pages?$/i.exec(pageChoice.value)?.[1]);
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 4 ||
    pageCount > 200 ||
    pageCount % 2
  )
    invalid("This page count is not supported by Studio yet.");
  return {
    schemaVersion: 1,
    productId: product.id,
    productName: product.name,
    format: config.format,
    options,
    quantity: input.quantity,
    personalText: input.personalText,
    pageCount,
    ...photoRequirement(pageCount),
  };
}
export async function validateSelection(input: StudioSelection) {
  const product = await prisma.component.findFirst({
    where: { id: input.productId, isActive: true },
    select: { id: true, name: true, configuration: true },
  });
  if (!product)
    throw new StudioProjectError(
      404,
      "STUDIO_PRODUCT_UNAVAILABLE",
      "This album is no longer available. Choose another album.",
    );
  return resolveConfiguration(product, input);
}

export async function listStudioFormats() {
  const rows = await prisma.component.findMany({
    where: { isActive: true },
    select: { id: true, name: true, configuration: true },
    orderBy: { name: "asc" },
  });
  return rows.flatMap((row) => {
    const config = configurationSchema.safeParse(row.configuration);
    if (
      !config.success ||
      !["album", "book"].includes(config.data.format) ||
      !config.data.allowPhotoUpload
    )
      return [];
    return [{ id: row.id, name: row.name, groups: config.data.groups }];
  });
}
