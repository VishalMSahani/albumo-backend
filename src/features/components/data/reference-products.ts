import { emptyConfiguration } from "../types/catalogue.js";
import type {
  ProductChoice,
  ProductConfiguration,
  ProductOptionGroup,
  OptionKind,
} from "../types/catalogue.js";
import { configurationSchema } from "../validators/catalogue.js";

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
function choice(label: string, price = 0, description = ""): ProductChoice {
  return {
    id: slug(label),
    label,
    description,
    priceAdjustmentCents: price * 100,
  };
}
function group(
  label: string,
  kind: OptionKind,
  options: ProductChoice[],
  required = true,
): ProductOptionGroup {
  return {
    id: slug(label),
    label,
    kind,
    required,
    defaultOptionId: required ? options[0]!.id : "",
    options,
  };
}
function sizes(...values: [number, number, number][]) {
  return group(
    "Size",
    "dimension",
    values.map(([width, height, price]) => ({
      ...choice(width + " x " + height + " in", price),
      width,
      height,
      unit: "in" as const,
    })),
  );
}
function designs(...labels: string[]) {
  return group(
    "Design",
    "design",
    labels.map((label) => choice(label)),
  );
}
const albumGroups = () => [
  sizes([8, 8, 0], [10, 10, 500], [12, 12, 1000]),
  group("Cover", "cover", [
    choice("Printed hardcover"),
    choice("Linen hardcover", 300),
  ]),
  group("Paper", "paper", [
    choice("Matte photo paper"),
    choice("Lustre photo paper", 200),
  ]),
  group("Pages", "pages", [
    choice("20 pages"),
    choice("40 pages", 500),
    choice("60 pages", 1000),
  ]),
];
const examples: Record<
  string,
  {
    name: string;
    price: number;
    format: ProductConfiguration["format"];
    groups: () => ProductOptionGroup[];
  }
> = {
  "Travel Books": {
    name: "Wanderlust Travel Book",
    price: 1299,
    format: "book",
    groups: () => [
      ...albumGroups(),
      designs("Travel journal", "Full-bleed stories", "Minimal captions"),
    ],
  },
  "Wedding Albums": {
    name: "Our Day Wedding Album",
    price: 2999,
    format: "album",
    groups: () => [
      ...albumGroups(),
      group("Binding", "binding", [
        choice("Layflat"),
        choice("Flush mount", 1000),
      ]),
      designs("Classic editorial", "Modern romance"),
      group(
        "Presentation box",
        "extra",
        [choice("Linen keepsake box", 600)],
        false,
      ),
    ],
  },
  "Birthday Albums": {
    name: "Birthday Stories Album",
    price: 1499,
    format: "album",
    groups: () => [
      ...albumGroups(),
      designs("Playful colour", "Milestone story"),
    ],
  },
  "Everyday Stories": {
    name: "Little Moments Photo Book",
    price: 999,
    format: "book",
    groups: () => [
      sizes([6, 6, 0], [8, 8, 300]),
      group("Cover", "cover", [choice("Softcover"), choice("Hardcover", 300)]),
      group("Pages", "pages", [choice("24 pages"), choice("48 pages", 400)]),
      designs("Everyday grid", "One moment per page"),
    ],
  },
  "Canvas Prints": {
    name: "Gallery Canvas Print",
    price: 899,
    format: "print",
    groups: () => [
      sizes([8, 12, 0], [12, 18, 500], [16, 24, 1100]),
      group("Canvas finish", "finish", [choice("Matte"), choice("Satin", 150)]),
      group("Edge style", "binding", [
        choice("Gallery wrap"),
        choice("White edge"),
      ]),
      designs("Single photo", "Photo collage"),
    ],
  },
  "Framed Prints": {
    name: "Everyday Framed Print",
    price: 799,
    format: "print",
    groups: () => [
      sizes([8, 10, 0], [12, 16, 500]),
      group("Frame", "frame", [
        choice("Black"),
        choice("White"),
        choice("Natural wood", 250),
      ]),
      group("Mount", "finish", [
        choice("No mount"),
        choice("White mount", 150),
      ]),
      designs("Full photo", "Caption border"),
    ],
  },
  "Acrylic Prints": {
    name: "Clear View Acrylic Print",
    price: 1499,
    format: "print",
    groups: () => [
      sizes([8, 12, 0], [12, 18, 900]),
      group("Acrylic thickness", "finish", [
        choice("3 mm"),
        choice("5 mm", 400),
      ]),
      group("Mounting", "extra", [
        choice("Wall spacers"),
        choice("Hidden hanging mount", 250),
      ]),
      designs("Edge-to-edge photo"),
    ],
  },
  "Photo Mugs": {
    name: "Daily Joy Photo Mug",
    price: 349,
    format: "gift",
    groups: () => [
      group("Capacity", "extra", [choice("325 ml"), choice("450 ml", 100)]),
      group("Mug finish", "finish", [
        choice("Glossy ceramic"),
        choice("Matte ceramic", 80),
      ]),
      group("Handle and inner colour", "color", [
        choice("White"),
        choice("Rose", 50),
        choice("Black", 50),
      ]),
      designs("Single photo and name", "Wraparound collage"),
    ],
  },
  "Photo Cushions": {
    name: "Favourite People Photo Cushion",
    price: 599,
    format: "gift",
    groups: () => [
      sizes([12, 12, 0], [16, 16, 200]),
      group("Fabric", "cover", [choice("Polyester"), choice("Velvet", 150)]),
      group("Filling", "extra", [
        choice("Cover only"),
        choice("Cover with insert", 200),
      ]),
      designs("Single photo", "Four-photo grid"),
    ],
  },
  Calendars: {
    name: "A Year of Memories Calendar",
    price: 499,
    format: "gift",
    groups: () => [
      sizes([6, 8, 0], [8, 10, 200]),
      group("Calendar type", "binding", [
        choice("Desk stand"),
        choice("Wall hanging", 100),
      ]),
      group("Paper", "paper", [
        choice("Matte card"),
        choice("Lustre card", 100),
      ]),
      designs("Minimal monthly", "Photo-led monthly"),
    ],
  },
  "Small Keepsakes": {
    name: "Pocket Memories Photo Magnet",
    price: 149,
    format: "gift",
    groups: () => [
      sizes([2, 3, 0], [3, 4, 80]),
      group("Material", "finish", [
        choice("Flexible magnet"),
        choice("Acrylic magnet", 120),
      ]),
      group("Pack size", "extra", [choice("Single"), choice("Set of 4", 350)]),
      designs("Full photo", "Polaroid-style border"),
    ],
  },
};
export type ReferenceCategory = {
  id: string;
  name: string;
  configuration: unknown;
  category: { name: string };
};
/** Illustrative products only: no supplier specifications or prices are claimed as verified. */
export function referenceProduct(category: ReferenceCategory) {
  const example = examples[category.name];
  const preset = configurationSchema.safeParse(category.configuration);
  const configuration: ProductConfiguration =
    preset.success && preset.data.groups.length
      ? preset.data
      : example
        ? {
            ...emptyConfiguration,
            format: example.format,
            personalizationEnabled: true,
            allowPhotoUpload: true,
            allowText: true,
            instructions:
              "Reference options only. Confirm materials, sizes, production time and prices before publishing.",
            productionDays: null,
            groups: example.groups(),
          }
        : preset.success
          ? preset.data
          : { ...emptyConfiguration };
  return {
    name: (example?.name ?? category.name + " Example") + " (Reference)",
    sku: "ALBUMO-REF-" + category.id,
    slug: "reference-" + slug(category.name) + "-" + category.id,
    subcategoryId: category.id,
    category: category.category.name,
    subcategory: category.name,
    productType: "OTHER" as const,
    brand: "Albumo",
    unitPriceCents: (example?.price ?? 100) * 100,
    discountedPriceCents: null,
    stockQuantity: 0,
    isActive: false,
    isBestSeller: false,
    isRobomaniacItem: false,
    isSoftware: false,
    tags: ["reference", slug(category.name)],
    imageUrl: null,
    description:
      "Reference listing for " +
      category.name +
      ". Use this as a starting point, then replace the description, images, prices and options with your confirmed product details before publishing.",
    typicalUseCase: "Example catalogue listing for " + category.name + ".",
    specifications: [
      {
        label: "Listing status",
        value: "Reference only. Product details and prices need review.",
      },
    ],
    configuration: configurationSchema.parse(configuration),
  };
}
