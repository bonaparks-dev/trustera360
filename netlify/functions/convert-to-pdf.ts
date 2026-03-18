import { Handler } from '@netlify/functions'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import mammoth from 'mammoth'

// Parse multipart form data (minimal parser for single file upload)
function parseMultipart(body: string, boundary: string): { filename: string; data: Buffer; contentType: string } | null {
  const parts = body.split(`--${boundary}`)
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const headers = part.substring(0, headerEnd)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    if (!filenameMatch) continue
    const contentTypeMatch = headers.match(/Content-Type:\s*(.+)\r?\n/i)
    const dataStart = headerEnd + 4
    let dataEnd = part.length
    if (part.endsWith('--\r\n')) dataEnd -= 4
    else if (part.endsWith('\r\n')) dataEnd -= 2
    return {
      filename: filenameMatch[1],
      data: Buffer.from(part.substring(dataStart, dataEnd), 'binary'),
      contentType: contentTypeMatch?.[1]?.trim() || 'application/octet-stream'
    }
  }
  return null
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const contentType = event.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)/)
    if (!boundaryMatch) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Multipart form data richiesto' }) }
    }

    const bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('binary')
      : event.body || ''

    const file = parseMultipart(bodyStr, boundaryMatch[1])
    if (!file) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Nessun file trovato' }) }
    }

    const ext = file.filename.split('.').pop()?.toLowerCase() || ''

    // DOCX → HTML → PDF
    if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ buffer: file.data })
      const text = result.value || ''

      if (!text.trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Documento vuoto o non leggibile' }) }
      }

      // Build PDF from extracted text
      const pdfDoc = await PDFDocument.create()
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const fontSize = 11
      const margin = 50
      const a4W = 595, a4H = 842
      const lineHeight = fontSize * 1.4
      const maxWidth = a4W - margin * 2
      const maxLinesPerPage = Math.floor((a4H - margin * 2) / lineHeight)

      // Word-wrap text into lines
      const paragraphs = text.split('\n')
      const allLines: string[] = []
      for (const para of paragraphs) {
        if (!para.trim()) { allLines.push(''); continue }
        const words = para.split(/\s+/)
        let currentLine = ''
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word
          const width = font.widthOfTextAtSize(testLine, fontSize)
          if (width > maxWidth && currentLine) {
            allLines.push(currentLine)
            currentLine = word
          } else {
            currentLine = testLine
          }
        }
        if (currentLine) allLines.push(currentLine)
      }

      // Render lines to pages
      for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
        const pageLines = allLines.slice(i, i + maxLinesPerPage)
        const page = pdfDoc.addPage([a4W, a4H])
        let y = a4H - margin
        for (const line of pageLines) {
          if (line.trim()) {
            page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
          }
          y -= lineHeight
        }
      }

      const pdfBytes = await pdfDoc.save()

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/pdf' },
        body: Buffer.from(pdfBytes).toString('base64'),
        isBase64Encoded: true
      }
    }

    // TXT/RTF → PDF
    if (ext === 'txt' || ext === 'rtf') {
      let text = file.data.toString('utf-8')
      // Strip RTF formatting if RTF
      if (ext === 'rtf') {
        text = text.replace(/\{\\rtf[^}]*\}/g, '').replace(/\\[a-z]+\d*\s?/g, '').replace(/[{}]/g, '')
      }

      const pdfDoc = await PDFDocument.create()
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const fontSize = 11
      const margin = 50
      const a4W = 595, a4H = 842
      const lineHeight = fontSize * 1.4
      const maxWidth = a4W - margin * 2
      const maxLinesPerPage = Math.floor((a4H - margin * 2) / lineHeight)

      const paragraphs = text.split('\n')
      const allLines: string[] = []
      for (const para of paragraphs) {
        if (!para.trim()) { allLines.push(''); continue }
        const words = para.split(/\s+/)
        let currentLine = ''
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word
          const width = font.widthOfTextAtSize(testLine, fontSize)
          if (width > maxWidth && currentLine) {
            allLines.push(currentLine)
            currentLine = word
          } else {
            currentLine = testLine
          }
        }
        if (currentLine) allLines.push(currentLine)
      }

      for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
        const pageLines = allLines.slice(i, i + maxLinesPerPage)
        const page = pdfDoc.addPage([a4W, a4H])
        let y = a4H - margin
        for (const line of pageLines) {
          if (line.trim()) {
            page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
          }
          y -= lineHeight
        }
      }

      const pdfBytes = await pdfDoc.save()
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/pdf' },
        body: Buffer.from(pdfBytes).toString('base64'),
        isBase64Encoded: true
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Formato .${ext} non supportato. Usa PDF, DOCX, TXT o immagini.` }) }
  } catch (error: any) {
    console.error('[convert-to-pdf] Error:', error)
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Errore nella conversione' }) }
  }
}
