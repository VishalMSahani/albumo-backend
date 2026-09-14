/** The original price is retained as compare-at; checkout uses a valid sale price when present. */
export function sellingPrice(product: { unitPriceCents: number; discountedPriceCents?: number | null }): number {
  const sale = product.discountedPriceCents;
  return typeof sale === 'number' && Number.isSafeInteger(sale) && sale >= 0 && sale < product.unitPriceCents
    ? sale : product.unitPriceCents;
}
