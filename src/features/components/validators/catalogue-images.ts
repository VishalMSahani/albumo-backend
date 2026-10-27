import { z } from "zod";
/** Public catalogue assets must use Albumo's CDN; private originals never belong here. */
export function isCatalogueImage(value: string) {
  try {
    const configured = process.env.R2_PUBLIC_DOMAIN || "https://cdn.albumo.in";
    const origin = new URL(
      configured.includes("://") ? configured : "https://" + configured,
    ).origin;
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export const catalogueImageSchema = z
  .string()
  .max(2000)
  .refine(isCatalogueImage, "Use an Albumo CDN image URL without query parameters");
