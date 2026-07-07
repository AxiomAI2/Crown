// Minimal ambient types for the `qrcode` package (no @types published we depend on). We use only the
// browser-safe `toString({ type: "svg" })` path — see src/lib/qr.ts. Keep this in sync if we use more.
declare module "qrcode" {
  interface QRCodeToStringOptions {
    type?: "svg" | "utf8" | "terminal";
    margin?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
    width?: number;
  }
  function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
  const _default: { toString: typeof toString };
  export default _default;
  export { toString };
}
