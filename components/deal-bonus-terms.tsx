"use client"

import { useEffect, useRef, useState, type ClipboardEvent } from "react"
import { MAX_BONUS_TERMS_HTML_LENGTH } from "@/lib/services/deal-contract-fields"

const allowed = new Set([
  "p", "div", "br", "strong", "em", "u", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
])
const omitted = new Set(["script", "style", "template", "noscript", "iframe", "object", "embed", "textarea", "select"])

function cleanMarkup(html: string): HTMLDivElement {
  const source = document.createElement("template")
  source.innerHTML = html
  const result = document.createElement("div")

  // Recreate an allowlisted structure. Source elements and attributes never enter the live document.
  function append(parent: Node, node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""))
      return
    }
    if (!(node instanceof HTMLElement) || omitted.has(node.localName)) return
    const tag = node.localName === "b" ? "strong" : node.localName === "i" ? "em" : node.localName
    const element = allowed.has(tag) ? document.createElement(tag) : null
    let destination = element ?? parent
    if (element) parent.appendChild(element)
    if (tag === "th" || tag === "td") {
      for (const name of ["rowspan", "colspan"]) {
        const span = Number(node.getAttribute(name))
        if (Number.isInteger(span) && span > 1 && span <= 1000) element?.setAttribute(name, String(span))
      }
    }
    if (tag === "span" || tag === "font") {
      const { fontWeight, fontStyle, textDecoration, textDecorationLine } = node.style
      const formatting = [
        fontWeight === "bold" || Number(fontWeight) >= 600 ? "strong" : "",
        fontStyle === "italic" ? "em" : "",
        /\bunderline\b/.test(textDecorationLine || textDecoration) ? "u" : "",
      ]
      for (const type of formatting) {
        if (!type) continue
        const wrapper = document.createElement(type)
        destination.appendChild(wrapper)
        destination = wrapper
      }
    }
    for (const child of node.childNodes) append(destination, child)
  }

  for (const node of source.content.childNodes) append(result, node)
  return result
}

type BonusTerms = { text: string; html?: string }

function showBonusTerms(target: HTMLDivElement, { text, html }: BonusTerms) {
  const formatted = html ? cleanMarkup(html) : null
  if (formatted?.textContent?.trim()) target.replaceChildren(...formatted.childNodes)
  else target.textContent = text
}

export function DealBonusTermsValue({ text, html }: BonusTerms) {
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (content.current) showBonusTerms(content.current, { text, html })
  }, [text, html])
  return <div className="deal-bonus-terms overflow-x-auto whitespace-pre-wrap break-words" ref={content} />
}

export function DealBonusTermsEditor({ id, text, html, onChange }: BonusTerms & {
  id: string; onChange: (text: string, html: string) => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const lastEdited = useRef<BonusTerms | null>(null)
  const [pasteError, setPasteError] = useState(false)
  useEffect(() => {
    if (lastEdited.current?.text === text && lastEdited.current.html === (html ?? "")) return
    if (content.current) showBonusTerms(content.current, { text, html })
  }, [text, html])

  function update(editor: HTMLDivElement) {
    const text = editor.innerText.trim()
    const formatted = text ? cleanMarkup(editor.innerHTML) : null
    const html = formatted?.querySelector("table,strong,em,u,ul,ol") ? formatted.innerHTML : ""
    lastEdited.current = { text, html }
    onChange(text, html)
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const editor = event.currentTarget
    const html = event.clipboardData.getData("text/html")
    const formatted = html ? cleanMarkup(html) : null
    const fragment = document.createDocumentFragment()
    if (formatted?.textContent?.trim()) {
      if (formatted.innerHTML.length > MAX_BONUS_TERMS_HTML_LENGTH) {
        setPasteError(true)
        return
      }
      fragment.append(...formatted.childNodes)
    } else {
      fragment.append(event.clipboardData.getData("text/plain"))
    }
    const selection = window.getSelection()
    if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return
    const range = selection.getRangeAt(0)
    const lastNode = fragment.lastChild
    if (!lastNode) return
    range.deleteContents()
    range.insertNode(fragment)
    range.setStartAfter(lastNode)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    setPasteError(false)
    update(editor)
  }

  return <>
    <div id={id} ref={content} role="textbox" aria-labelledby={id + "-label"} aria-describedby={id + "-help"}
      aria-multiline="true" aria-required="true" contentEditable suppressContentEditableWarning
      className="deal-bonus-terms min-h-24 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-sm outline-offset-2 focus-visible:outline-2"
      onInput={event => { setPasteError(false); update(event.currentTarget) }} onPaste={paste}
      onDrop={event => event.preventDefault()} />
    <p id={id + "-help"} className="text-xs text-muted-foreground">可直接粘贴 Word 表格，粘贴后可编辑单元格。</p>
    {(pasteError || (html?.length ?? 0) > MAX_BONUS_TERMS_HTML_LENGTH) &&
      <p role="alert" className="text-sm text-destructive">格式内容过长，请精简表格后再保存。</p>}
  </>
}
