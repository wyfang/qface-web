import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

/** 同一表情、同一资源类型内按内容去重，优先保留以表情 ID 命名的文件。 */
export async function uniqueAssetFiles<T extends { name: string; path: string }>(
  files: T[],
  emojiId: string
): Promise<T[]> {
  if (files.length < 2) return [...files]

  const sortedFiles = [...files].sort((a, b) => {
    const aMatchesId = basename(a.name, extname(a.name)) === emojiId
    const bMatchesId = basename(b.name, extname(b.name)) === emojiId
    return Number(bMatchesId) - Number(aMatchesId) || a.path.localeCompare(b.path)
  })
  const seenHashes = new Set<string>()
  const uniqueFiles: T[] = []

  for (const file of sortedFiles) {
    const hash = createHash('sha256').update(await readFile(file.path)).digest('hex')
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)
    uniqueFiles.push(file)
  }

  return uniqueFiles
}
