import { SaxesParser } from "saxes";

export function acceptsUtf8(markup) {
  const parser = new SaxesParser({ xmlns: true });
  const rejected = new Error("Unsupported SVG XML input");
  parser.on("error", () => { throw rejected; });
  parser.on("xmldecl", ({ encoding }) => {
    if (encoding !== undefined && encoding.toLowerCase() !== "utf-8") throw rejected;
  });
  try {
    parser.write(markup).close();
  } catch (error) {
    if (error === rejected) return false;
    throw error;
  }
  return true;
}
