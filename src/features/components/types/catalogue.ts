/** Catalogue configuration shared by the API, admin and storefront. Money is INR paise. */
export type OptionKind =
  | "dimension"
  | "cover"
  | "paper"
  | "finish"
  | "binding"
  | "pages"
  | "design"
  | "color"
  | "frame"
  | "extra";
export type ProductChoice = {
  id: string;
  label: string;
  description: string;
  priceAdjustmentCents: number;
  width?: number | undefined;
  height?: number | undefined;
  unit?: "in" | "cm" | "mm" | undefined;
  imageUrl?: string | undefined;
};
export type ProductOptionGroup = {
  id: string;
  label: string;
  kind: OptionKind;
  required: boolean;
  defaultOptionId: string;
  options: ProductChoice[];
};
export type ProductConfiguration = {
  format: "album" | "book" | "print" | "gift";
  personalizationEnabled: boolean;
  allowPhotoUpload: boolean;
  allowText: boolean;
  instructions: string;
  productionDays: number | null;
  groups: ProductOptionGroup[];
};
export const emptyConfiguration: ProductConfiguration = {
  format: "album",
  personalizationEnabled: false,
  allowPhotoUpload: false,
  allowText: false,
  instructions: "",
  productionDays: null,
  groups: [],
};
