# -*- coding: utf-8 -*-
"""
render_preview.py <pdf> <outdir> [dpi]
把 PDF 逐頁轉 PNG(用 PyMuPDF,免 poppler/pdftoppm)。
給 Phase 0 的「人眼 truth-check」用:確認程式化 QA(slide_qa)沒在說謊。
"""
import sys
import fitz  # PyMuPDF


def main():
    pdf = sys.argv[1]
    outdir = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    doc = fitz.open(pdf)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    paths = []
    for i, page in enumerate(doc, 1):
        pix = page.get_pixmap(matrix=mat)
        out = f"{outdir}/slide_{i:02d}.png"
        pix.save(out)
        paths.append(out)
    print("\n".join(paths))


if __name__ == "__main__":
    main()
