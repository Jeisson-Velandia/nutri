/** Redimensiona una foto a máx. `max` px de lado y la devuelve como JPEG base64 (sin prefijo). */
export async function resizeToBase64(file: File | Blob, max = 1024, quality = 0.82) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { base64: dataUrl.split(',')[1], dataUrl }
}
