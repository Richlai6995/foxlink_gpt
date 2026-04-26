'use strict';
/**
 * skillHelpers.js
 *
 * Skill 作者用的 helper:把 markdown / html 包成 artifact 物件,
 * skillRunner 偵測到後會 passthrough 給前端、不經 LLM 整理。
 *
 * 詳見 docs/tool-artifact-passthrough.md §5
 */

function toMarkdownArtifact(markdown, title) {
  return { mime: 'text/markdown', title: String(title || ''), content: String(markdown || '') };
}

function toHtmlArtifact(html, title) {
  return { mime: 'text/html', title: String(title || ''), content: String(html || '') };
}

module.exports = { toMarkdownArtifact, toHtmlArtifact };
