/** Native inset-adjusted scroll views rest at -contentInset.top, ordinary lists at zero. */
export function pastScrollEdge(offset: number, insetTop = 0, threshold = 8): boolean {
  return offset + insetTop > threshold
}
