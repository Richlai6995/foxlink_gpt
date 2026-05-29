#!/usr/bin/env python3
"""
pdf_to_docx_worker.py — PDF inspect + 文字型 PDF 轉 DOCX。

Phase 1a:只實作 inspect(回 metadata + 偵測加密/掃描)
Phase 1b:加入 convert(走 pdf2docx 主路線)

CLI(全程 stdout 只吐一行 JSON,stderr 走 log):
  python pdf_to_docx_worker.py inspect --in <pdf> [--password <pwd>]
  python pdf_to_docx_worker.py convert --in <pdf> --out <docx> [--password <pwd>]

JSON 回傳一律含 "ok": bool
  ok=False:
    error_code: PASSWORD_REQUIRED | PASSWORD_WRONG | OPEN_FAILED | CONVERT_FAILED | INVALID_ARGS
    error: human-readable
  ok=True (inspect):
    pages, encrypted, scanned_ratio, text_pages, image_pages, file_size_bytes
  ok=True (convert):
    out_path, pages_converted, elapsed_ms
"""
import argparse
import json
import os
import sys
import time
import traceback

# Windows 預設 stdout = cp950,中文 JSON 會炸 Node utf8 decoder。
# Python 3.7+ 支援 reconfigure(Docker Linux 上本來就 utf-8,無害)。
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# 掃描頁判定閾值:可選取文字 < N 字 且 有至少 1 張圖
SCANNED_TEXT_THRESHOLD = 50
SCANNED_RATIO_THRESHOLD = 0.8  # 整份 ≥ 80% 頁是掃描頁 → 視為掃描型 PDF


def log(msg):
    """stderr 給 Node 那邊收 log,不污染 stdout JSON。"""
    print(f"[pdf_worker] {msg}", file=sys.stderr, flush=True)


def emit(payload):
    """stdout 只能有一行 JSON。"""
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def open_pdf(path, password=None):
    """
    開檔 + 處理加密。
    Returns (doc, error_payload):
      成功 → (doc, None)
      加密缺密碼 / 密碼錯 → (None, {ok:False, error_code:...})
    """
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(path)
    except Exception as e:
        return None, {
            "ok": False,
            "error_code": "OPEN_FAILED",
            "error": f"無法開啟 PDF:{e}",
        }

    if doc.needs_pass:
        if not password:
            doc.close()
            return None, {
                "ok": False,
                "error_code": "PASSWORD_REQUIRED",
                "error": "此 PDF 已加密,需要密碼",
            }
        # authenticate 回傳:0=失敗,>0=成功(user/owner 不同等級)
        if doc.authenticate(password) == 0:
            doc.close()
            return None, {
                "ok": False,
                "error_code": "PASSWORD_WRONG",
                "error": "PDF 密碼錯誤",
            }
    return doc, None


def cmd_inspect(args):
    doc, err = open_pdf(args.input, args.password)
    if err:
        emit(err)
        return

    try:
        total = doc.page_count
        text_pages = 0
        image_pages = 0
        scanned_pages = 0

        for i in range(total):
            page = doc.load_page(i)
            text_len = len(page.get_text("text").strip())
            img_count = len(page.get_images(full=False))
            if text_len >= SCANNED_TEXT_THRESHOLD:
                text_pages += 1
            if img_count > 0:
                image_pages += 1
            if text_len < SCANNED_TEXT_THRESHOLD and img_count >= 1:
                scanned_pages += 1

        scanned_ratio = (scanned_pages / total) if total > 0 else 0.0
        try:
            file_size = os.path.getsize(args.input)
        except OSError:
            file_size = None

        emit({
            "ok": True,
            "pages": total,
            "encrypted": bool(doc.needs_pass),  # 已用密碼解開仍視為原本加密
            "scanned_ratio": round(scanned_ratio, 3),
            "is_scanned_pdf": scanned_ratio >= SCANNED_RATIO_THRESHOLD,
            "text_pages": text_pages,
            "image_pages": image_pages,
            "scanned_pages": scanned_pages,
            "file_size_bytes": file_size,
        })
    finally:
        doc.close()


def cmd_convert(args):
    if not args.output:
        emit({"ok": False, "error_code": "INVALID_ARGS", "error": "convert 需要 --out"})
        return

    # 先 inspect 一次處理加密(open_pdf 已包好錯誤回傳)
    doc, err = open_pdf(args.input, args.password)
    if err:
        emit(err)
        return
    pages = doc.page_count
    doc.close()

    # 走 pdf2docx 主路線
    try:
        from pdf2docx import Converter
    except Exception as e:
        emit({"ok": False, "error_code": "CONVERT_FAILED", "error": f"pdf2docx import 失敗:{e}"})
        return

    t0 = time.time()
    try:
        # pdf2docx 自己會處理密碼(它內部也用 PyMuPDF);若 None 就傳 None
        cv = Converter(args.input, password=args.password) if args.password else Converter(args.input)
        try:
            cv.convert(args.output, start=0, end=None)
        finally:
            cv.close()
    except Exception as e:
        log(f"convert exception: {traceback.format_exc()}")
        emit({
            "ok": False,
            "error_code": "CONVERT_FAILED",
            "error": f"pdf2docx 轉換失敗:{e}",
        })
        return

    elapsed_ms = int((time.time() - t0) * 1000)
    emit({
        "ok": True,
        "out_path": os.path.abspath(args.output),
        "pages_converted": pages,
        "elapsed_ms": elapsed_ms,
    })


def main():
    parser = argparse.ArgumentParser(description="PDF → DOCX worker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ins = sub.add_parser("inspect", help="檢查 PDF metadata / 加密 / 掃描")
    p_ins.add_argument("--in", dest="input", required=True)
    p_ins.add_argument("--password", default=None)

    p_cv = sub.add_parser("convert", help="文字型 PDF → DOCX (pdf2docx)")
    p_cv.add_argument("--in", dest="input", required=True)
    p_cv.add_argument("--out", dest="output", required=True)
    p_cv.add_argument("--password", default=None)

    args = parser.parse_args()

    if not os.path.isfile(args.input):
        emit({
            "ok": False,
            "error_code": "OPEN_FAILED",
            "error": f"檔案不存在:{args.input}",
        })
        return

    try:
        if args.cmd == "inspect":
            cmd_inspect(args)
        elif args.cmd == "convert":
            cmd_convert(args)
    except Exception as e:
        log(f"unhandled exception: {traceback.format_exc()}")
        emit({
            "ok": False,
            "error_code": "OPEN_FAILED",
            "error": f"worker uncaught: {e}",
        })


if __name__ == "__main__":
    main()
