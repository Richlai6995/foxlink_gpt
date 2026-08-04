import type { KeyboardEvent } from 'react'

/**
 * IME 組字中(注音/倉頡/日韓選字)按 Enter 只是確認候選字,不能當送出。
 * isComposing 在部分瀏覽器(Safari / 某些 Chrome 版)確認鍵當下會是 false,
 * 補 keyCode===229(IME 組字 keydown 的標準 sentinel)雙保險。
 */
export const isImeComposing = (e: KeyboardEvent): boolean =>
  e.nativeEvent.isComposing || (e.nativeEvent as globalThis.KeyboardEvent).keyCode === 229

/** Enter 送出(排除 Shift+Enter 換行 & IME 組字中的 Enter)。 */
export const isEnterSubmit = (e: KeyboardEvent): boolean =>
  e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)
