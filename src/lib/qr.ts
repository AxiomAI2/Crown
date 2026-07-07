/**
 * QR-code SVG for a realm's share link. Generated fully client-side (no network — the link never leaves the
 * browser) via the `qrcode` package, dynamically imported so it stays out of the main bundle. Colors follow
 * the CROWN palette by default (dark modules on a transparent light). Returns an inline `<svg>` string.
 */
export async function qrSvg(
  text: string,
  opts: { dark?: string; light?: string } = {},
): Promise<string> {
  const QR = (await import("qrcode")).default;
  return QR.toString(text, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: opts.dark ?? "#0d0d0d", light: opts.light ?? "#ffffff" },
  });
}
