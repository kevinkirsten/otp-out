import qrcode from "qrcode-generator";

export interface QrMatrix {
  size: number;
  /** Caminho SVG com um quadrado por módulo escuro, em unidades de módulo. */
  path: string;
  /** Margem branca em módulos (a norma pede 4). */
  margin: number;
}

/** Gera o QR de um texto ASCII (a URI otpauth:// já vem toda escapada). */
export function qrMatrix(text: string, margin = 4): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row += 1) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col += 1;
        continue;
      }
      // Junta módulos escuros vizinhos na mesma linha num retângulo só.
      let end = col;
      while (end + 1 < count && qr.isDark(row, end + 1)) end += 1;
      path += `M${col + margin} ${row + margin}h${end - col + 1}v1h-${end - col + 1}z`;
      col = end + 1;
    }
  }
  return { size: count + margin * 2, path, margin };
}
