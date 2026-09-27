import { Capacitor } from '@capacitor/core'
import {
  CapacitorNfc,
  type NdefRecord as NativeNdefRecord,
} from '@capgo/capacitor-nfc'

import type { NdefRecord, ScannedNfcTag } from '../types/nfc'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const TNF_EMPTY = 0x00
const TNF_WELL_KNOWN = 0x01
const TNF_MIME_MEDIA = 0x02
const TNF_ABSOLUTE_URI = 0x03
const TNF_EXTERNAL_TYPE = 0x04
const TNF_UNKNOWN = 0x05
const TNF_UNCHANGED = 0x06

const TEXT_RECORD_TYPE = 'T'
const URI_RECORD_TYPE = 'U'

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberArray(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return value.map((entry) => entry & 0xff)
  }

  if (value instanceof Uint8Array) {
    return Array.from(value)
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
  }

  if (value && typeof value === 'object' && 'buffer' in value) {
    const buffer = (value as { buffer?: unknown }).buffer
    if (buffer instanceof ArrayBuffer) return Array.from(new Uint8Array(buffer))
  }

  return null
}

function bytes(value: number[] | null | undefined): Uint8Array {
  return new Uint8Array(value ?? [])
}

function bytesToBase64(value: Uint8Array): string {
  let result = ''
  for (const byte of value) result += String.fromCharCode(byte)
  return window.btoa(result)
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = window.atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function decodeUtf8(value: number[] | null): string | null {
  if (!value || value.length === 0) return ''

  try {
    return textDecoder.decode(bytes(value))
  } catch {
    return null
  }
}

function toWebNfcBufferSource(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

function nativeTypeText(value: number[] | null): string {
  return decodeUtf8(value) ?? ''
}

function uriPrefix(index: number): string {
  const prefixes: Record<number, string> = {
    0x00: '',
    0x01: 'http://www.',
    0x02: 'https://www.',
    0x03: 'http://',
    0x04: 'https://',
    0x05: 'tel:',
    0x06: 'mailto:',
    0x07: 'ftp://anonymous:anonymous@',
    0x08: 'ftp://ftp.',
    0x09: 'ftps://',
    0x0a: 'sftp://',
    0x0b: 'smb://',
    0x0c: 'nfs://',
    0x0d: 'ftp://',
    0x0e: 'dav://',
    0x0f: 'news:',
    0x10: 'telnet://',
    0x11: 'imap:',
    0x12: 'rtsp://',
    0x13: 'urn:',
    0x14: 'pop:',
    0x15: 'sip:',
    0x16: 'sips:',
    0x17: 'tftp:',
    0x18: 'btspp://',
    0x19: 'btl2cap://',
    0x1a: 'btgoep://',
    0x1b: 'tcpobex://',
    0x1c: 'irdaobex://',
    0x1d: 'file://',
    0x1e: 'urn:epc:id:',
    0x1f: 'urn:epc:tag:',
    0x20: 'urn:epc:pat:',
    0x21: 'urn:epc:raw:',
    0x22: 'urn:epc:',
    0x23: 'urn:nfc:',
  }

  return prefixes[index] ?? ''
}

function recordTypeLabel(tnf: number, type: string): string {
  if (tnf === TNF_EMPTY) return 'empty'
  if (tnf === TNF_WELL_KNOWN && type === TEXT_RECORD_TYPE) return 'text'
  if (tnf === TNF_WELL_KNOWN && type === URI_RECORD_TYPE) return 'url'
  if (tnf === TNF_MIME_MEDIA) return 'mime'
  if (tnf === TNF_ABSOLUTE_URI) return 'absolute-url'
  if (tnf === TNF_WELL_KNOWN && type === 'Sp') return 'smart-poster'
  if (tnf === TNF_EXTERNAL_TYPE) return 'external'
  if (tnf === TNF_UNKNOWN || tnf === TNF_UNCHANGED) return 'unknown'
  return 'unknown'
}

function decodeNativeText(payload: number[]): {
  text: string | null
  language: string | null
  encoding: string | null
} {
  if (payload.length === 0) return { text: '', language: null, encoding: 'utf-8' }

  const status = payload[0]
  const isUtf16 = (status & 0x80) !== 0
  const languageLength = status & 0x3f
  const languageBytes = payload.slice(1, 1 + languageLength)
  const contentBytes = payload.slice(1 + languageLength)

  const encoding = isUtf16 ? 'utf-16' : 'utf-8'
  const decoder = new TextDecoder(isUtf16 ? 'utf-16' : 'utf-8')

  try {
    return {
      text: decoder.decode(bytes(contentBytes)),
      language: textDecoder.decode(bytes(languageBytes)) || null,
      encoding,
    }
  } catch {
    return { text: null, language: null, encoding }
  }
}

function decodeNativeUri(payload: number[]): string | null {
  if (payload.length === 0) return ''

  try {
    return uriPrefix(payload[0]) + textDecoder.decode(bytes(payload.slice(1)))
  } catch {
    return null
  }
}

function normaliseNativeRecord(value: unknown): NdefRecord {
  const source = asObject(value)
  const tnfValue = source.tnf
  const nativeTnf = typeof tnfValue === 'number' ? tnfValue : TNF_UNKNOWN
  const nativeType = numberArray(source.type) ?? []
  const nativeId = numberArray(source.id) ?? []
  const nativePayload = numberArray(source.payload) ?? numberArray(source.data) ?? []
  const typeText = nativeTypeText(nativeType)
  const recordType = recordTypeLabel(nativeTnf, typeText)

  let text: string | null = null
  let uri: string | null = null
  let language: string | null = null
  let encoding: string | null = null
  let mediaType: string | null = null
  let dataText: string | null = null

  if (recordType === 'text') {
    const decoded = decodeNativeText(nativePayload)
    text = decoded.text
    language = decoded.language
    encoding = decoded.encoding
    dataText = text
  } else if (recordType === 'url') {
    uri = decodeNativeUri(nativePayload)
    dataText = uri
  } else if (recordType === 'mime') {
    mediaType = typeText || 'application/octet-stream'
    dataText = decodeUtf8(nativePayload)
  } else if (recordType === 'absolute-url') {
    uri = typeText || null
    dataText = uri
  } else {
    dataText = decodeUtf8(nativePayload)
  }

  return {
    recordType,
    mediaType,
    id: nativeId.length > 0 ? decodeUtf8(nativeId) : null,
    encoding,
    language,
    text,
    uri,
    dataBase64: nativePayload.length > 0 ? bytesToBase64(bytes(nativePayload)) : null,
    dataText,
    nativeTnf,
    nativeType,
    nativeId,
    nativePayload,
  }
}

function normaliseWebRecord(record: NDEFRecord): NdefRecord {
  const raw = record.data
    ? Array.from(new Uint8Array(record.data.buffer.slice(0)))
    : []

  return {
    recordType: record.recordType || 'unknown',
    mediaType: record.mediaType || null,
    id: record.id || null,
    encoding: record.encoding || null,
    language: record.lang || null,
    text: null,
    uri: null,
    dataBase64: raw.length > 0 ? bytesToBase64(bytes(raw)) : null,
    dataText: raw.length > 0 ? decodeUtf8(raw) : null,
    nativeTnf: null,
    nativeType: null,
    nativeId: null,
    nativePayload: raw,
  }
}

function normaliseNativeTag(value: unknown): ScannedNfcTag {
  const event = asObject(value)

  const tag = asObject(
    event.tag ??
    event.nfcTag ??
    event.data ??
    value,
  )
  const candidateRecords =
    tag.records ??
    tag.ndefRecords ??
    tag.ndefMessage ??
    event.records ??
    event.ndefRecords ??
    []
  const records = Array.isArray(candidateRecords)
    ? candidateRecords.map(normaliseNativeRecord)
    : []

  const capacityValue = tag.capacity ?? tag.maxSize
  const writable = tag.isWritable ?? tag.writable

  return {
    uid: asString(tag.id) ?? asString(tag.uid) ?? asString(event.id),
    type: asString(tag.type) ?? asString(tag.techType) ?? 'NDEF',
    capacity: typeof capacityValue === 'number' ? capacityValue : null,
    isWritable: typeof writable === 'boolean' ? writable : null,
    records,
    rawNdef: tag,
    ndefFormat: 'native',
  }
}

type NdefRecordWithNativeBytes = NdefRecord & {
  nativeTnf: number
  nativeType: number[]
  nativeId: number[]
  nativePayload: number[]
}

function hasNativeBytes(
  record: NdefRecord,
): record is NdefRecordWithNativeBytes {
  return (
    typeof record.nativeTnf === 'number' &&
    Array.isArray(record.nativeType) &&
    Array.isArray(record.nativeId) &&
    Array.isArray(record.nativePayload)
  )
}

function fallbackNativeRecord(record: NdefRecord): NativeNdefRecord {
  const normalizedType = record.recordType.toLowerCase()

  if (normalizedType === 'text') {
    const language = record.language || 'fr'
    const languageBytes = Array.from(textEncoder.encode(language))
    const textBytes = Array.from(textEncoder.encode(record.text ?? record.dataText ?? ''))

    return {
      tnf: TNF_WELL_KNOWN,
      type: Array.from(textEncoder.encode(TEXT_RECORD_TYPE)),
      id: record.id ? Array.from(textEncoder.encode(record.id)) : [],
      payload: [languageBytes.length, ...languageBytes, ...textBytes],
    }
  }

  if (normalizedType === 'url') {
    const uri = record.uri ?? record.dataText ?? ''

    return {
      tnf: TNF_WELL_KNOWN,
      type: Array.from(textEncoder.encode(URI_RECORD_TYPE)),
      id: record.id ? Array.from(textEncoder.encode(record.id)) : [],
      payload: [0x00, ...Array.from(textEncoder.encode(uri))],
    }
  }

  const payload = record.dataBase64
    ? Array.from(base64ToBytes(record.dataBase64))
    : Array.from(textEncoder.encode(record.dataText ?? record.text ?? record.uri ?? ''))

  return {
    tnf: TNF_MIME_MEDIA,
    type: Array.from(textEncoder.encode(record.mediaType ?? 'application/octet-stream')),
    id: record.id ? Array.from(textEncoder.encode(record.id)) : [],
    payload,
  }
}

function nativeRecordFromRecord(record: NdefRecord): NativeNdefRecord {
  if (hasNativeBytes(record)) {
    return {
      tnf: record.nativeTnf,
      type: record.nativeType,
      id: record.nativeId,
      payload: record.nativePayload,
    }
  }

  return fallbackNativeRecord(record)
}

function webRecordFromRecord(record: NdefRecord): NDEFRecordInit {
  if (record.recordType === 'text') {
    return {
      recordType: 'text',
      data: record.text ?? record.dataText ?? '',
      id: record.id ?? undefined,
      lang: record.language ?? undefined,
      encoding: record.encoding ?? undefined,
    }
  }

  if (record.recordType === 'url' || record.recordType === 'absolute-url') {
    return {
      recordType: record.recordType,
      data: record.uri ?? record.dataText ?? '',
      id: record.id ?? undefined,
    }
  }

  const payload = record.nativePayload
    ? bytes(record.nativePayload)
    : record.dataBase64
      ? base64ToBytes(record.dataBase64)
      : textEncoder.encode(record.dataText ?? record.text ?? record.uri ?? '')

  return {
    recordType: record.recordType === 'unknown' ? 'mime' : record.recordType,
    mediaType: record.mediaType ?? 'application/octet-stream',
    id: record.id ?? undefined,
    data: toWebNfcBufferSource(payload),
  }
}

export function isNfcAvailable(): boolean {
  return Capacitor.isNativePlatform() || 'NDEFReader' in window
}

export async function scanNfcTag(
  onProgress?: (message: string) => void,
): Promise<ScannedNfcTag> {
  if (Capacitor.isNativePlatform()) {
    onProgress?.('Approche le tag NFC du téléphone…')

    return new Promise<ScannedNfcTag>(async (resolve, reject) => {
      let ndefListener: { remove: () => Promise<void> } | null = null
      let tagListener: { remove: () => Promise<void> } | null = null
      let mimeListener: { remove: () => Promise<void> } | null = null
      let timeoutId: number | null = null
      let completed = false

      async function cleanup(): Promise<void> {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }

        await ndefListener?.remove().catch(() => undefined)
        await tagListener?.remove().catch(() => undefined)
        await mimeListener?.remove().catch(() => undefined)

        /*
         * `stopScanning()` est la méthode du plugin Capgo.
         * Le cast est seulement là si tes typings exposent une version
         * légèrement différente de la méthode.
         */
        const nfc = CapacitorNfc as unknown as {
          stopScanning?: () => Promise<void>
        }

        await nfc.stopScanning?.().catch(() => undefined)
      }

      async function rejectScan(error: Error): Promise<void> {
        if (completed) {
          return
        }

        completed = true
        await cleanup()
        reject(error)
      }

      async function resolveTag(event: unknown): Promise<void> {
        if (completed) {
          return
        }

        console.info('[ArnTags] NFC event reçu :', event)

        const tag = normaliseNativeTag(event)

        /*
         * `ndefDiscovered` doit donner au minimum une liste de records.
         * `tagDiscovered` peut contenir un identifiant, mais aucun contenu
         * NDEF : on l’accepte seulement si l’UID ou les records existent.
         */
        const hasRealTag =
          tag.records.length > 0 ||
          tag.uid !== null

        if (!hasRealTag) {
          console.warn(
            '[ArnTags] Événement NFC ignoré : tag sans UID ni records.',
            event,
          )
          return
        }

        completed = true
        resolve(tag)
        window.setTimeout(() => {
          void cleanup()
        }, 750)
      }

      try {
        /*
         * Lecture normale de tags NDEF :
         * textes, URLs, MIME, Smart Posters, etc.
         */
        ndefListener = await CapacitorNfc.addListener(
          'ndefDiscovered',
          (event) => {
            void resolveTag(event)
          },
        )

        mimeListener = await CapacitorNfc.addListener(
          'ndefMimeDiscovered',
          (event) => {
            void resolveTag(event)
          },
        )
        /*
         * Fallback : tag détecté, mais non reconnu comme NDEF.
         * Cela aide à diagnostiquer un tag vierge, une carte MIFARE,
         * un badge protégé ou un format propriétaire.
         */
        tagListener = await CapacitorNfc.addListener(
          'tagDiscovered',
          (event) => {
            void resolveTag(event)
          },
        )

        timeoutId = window.setTimeout(() => {
          void rejectScan(
            new Error(
              'Aucun tag NFC détecté après 30 secondes. Vérifie que le NFC est activé et approche un tag NDEF compatible de la zone NFC du téléphone.',
            ),
          )
        }, 30_000)

        await CapacitorNfc.startScanning()
      } catch (error) {
        await rejectScan(
          error instanceof Error
            ? error
            : new Error('Impossible de démarrer la lecture NFC.'),
        )
      }
    })
  }

  if (!('NDEFReader' in window)) {
    throw new Error(
      'NFC indisponible. Utilise l’application native ou Chrome Android en HTTPS.',
    )
  }

  const reader = new NDEFReader()

  await reader.scan()
  onProgress?.('Approche le tag NFC du téléphone…')

  return new Promise<ScannedNfcTag>((resolve, reject) => {
    reader.onreadingerror = () => {
      reject(new Error('Le tag NFC n’a pas pu être lu.'))
    }

    reader.onreading = (event) => {
      resolve({
        uid: event.serialNumber || null,
        type: 'NDEF',
        capacity: null,
        isWritable: null,
        records: Array.from(event.message.records, normaliseWebRecord),
        rawNdef: null,
        ndefFormat: 'web',
      })
    }
  })
}

export async function writeNfcTag(
  records: NdefRecord[],
  onProgress?: (message: string) => void,
): Promise<void> {
  if (records.length === 0) {
    throw new Error(
      'Ce tag sauvegardé ne contient aucun enregistrement NDEF à écrire.',
    )
  }

  if (!Capacitor.isNativePlatform()) {
    if (!('NDEFReader' in window)) {
      throw new Error(
        'Écriture NFC indisponible dans ce navigateur. Utilise l’application native.',
      )
    }

    const writer = new NDEFReader()

    onProgress?.('Approche un tag NFC NDEF réinscriptible…')

    await writer.write({
      records: records.map(webRecordFromRecord),
    })

    return
  }

  onProgress?.('Approche le tag cible et garde-le immobile sur le téléphone…')

  return new Promise<void>(async (resolve, reject) => {
    let ndefListener: { remove: () => Promise<void> } | null = null
    let tagListener: { remove: () => Promise<void> } | null = null
    let timeoutId: number | null = null
    let completed = false

    async function cleanup(): Promise<void> {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }

      await ndefListener?.remove().catch(() => undefined)
      await tagListener?.remove().catch(() => undefined)
      await CapacitorNfc.stopScanning().catch(() => undefined)
    }

    async function fail(error: Error): Promise<void> {
      if (completed) {
        return
      }

      completed = true
      await cleanup()
      reject(error)
    }

    async function writeToCurrentTag(): Promise<void> {
      if (completed) {
        return
      }

      completed = true

      try {
        onProgress?.('Tag détecté. Écriture en cours, ne le retire pas…')

        /*
         * Le tag qui vient de déclencher ndefDiscovered/tagDiscovered
         * est le « last discovered tag » du plugin.
         *
         * Il faut appeler write immédiatement ici, avant stopScanning().
         */
        await CapacitorNfc.write({
          records: records.map(nativeRecordFromRecord),
        })

        onProgress?.('Écriture terminée.')
        resolve()
        window.setTimeout(() => {
          void cleanup()
        }, 750)
      } catch (error) {
        await cleanup()

        const errorText =
          error instanceof Error ? error.message : String(error)

        if (/lost|connection/i.test(errorText)) {
          reject(
            new Error(
              'Connexion NFC perdue. Garde le tag immobile contre le téléphone pendant toute l’écriture, puis réessaie.',
            ),
          )
          return
        }

        reject(
          new Error(
            errorText || 'Impossible d’écrire le contenu NDEF sur ce tag.',
          ),
        )
      }
    }

    try {
      /*
       * On écoute d’abord les événements. Dès qu’un tag cible est découvert,
       * on écrit immédiatement sur lui.
       */
      ndefListener = await CapacitorNfc.addListener(
        'ndefDiscovered',
        () => {
          void writeToCurrentTag()
        },
      )

      tagListener = await CapacitorNfc.addListener(
        'tagDiscovered',
        () => {
          void writeToCurrentTag()
        },
      )

      timeoutId = window.setTimeout(() => {
        void fail(
          new Error(
            'Aucun tag détecté après 30 secondes. Approche un tag NFC NDEF réinscriptible.',
          ),
        )
      }, 30_000)

      await CapacitorNfc.startScanning()
    } catch (error) {
      await fail(
        error instanceof Error
          ? error
          : new Error('Impossible de démarrer la session NFC d’écriture.'),
      )
    }
  })
}

export async function resetNfcTag(
  onProgress?: (message: string) => void,
): Promise<void> {
  onProgress?.('Approche le tag NFC à effacer et garde-le immobile…')

  if (Capacitor.isNativePlatform()) {
    return new Promise<void>(async (resolve, reject) => {
      let ndefListener: { remove: () => Promise<void> } | null = null
      let tagListener: { remove: () => Promise<void> } | null = null
      let timeoutId: number | null = null
      let completed = false

      async function cleanup(): Promise<void> {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }

        await ndefListener?.remove().catch(() => undefined)
        await tagListener?.remove().catch(() => undefined)
        await CapacitorNfc.stopScanning().catch(() => undefined)
      }

      async function fail(error: Error): Promise<void> {
        if (completed) return

        completed = true
        await cleanup()
        reject(error)
      }
      
      let writing = false

      async function eraseCurrentTag(): Promise<void> {
        if (completed || writing) return
        writing = true

        try {
          onProgress?.('Tag détecté. Garde-le immobile : effacement en cours…')

          await CapacitorNfc.erase()

          completed = true
          onProgress?.('Message NDEF effacé avec succès.')
          await cleanup()
          resolve()
        } catch (error) {
          completed = true
          await cleanup()

          const message = error instanceof Error ? error.message : String(error)
          reject(
            new Error(
              /lost|connection/i.test(message)
                ? 'Connexion NFC perdue. Garde le tag contre le téléphone jusqu’à la confirmation.'
                : message || 'Impossible d’effacer ce tag : vérifie qu’il est réinscriptible.',
            ),
          )
        }
      }

      try {
        /*
         * Il faut attendre la découverte du tag cible, puis écrire
         * immédiatement le record NDEF vide.
         */
        ndefListener = await CapacitorNfc.addListener(
          'ndefDiscovered',
          () => {
            void eraseCurrentTag()
          },
        )

        tagListener = await CapacitorNfc.addListener(
          'tagDiscovered',
          () => {
            void eraseCurrentTag()
          },
        )

        timeoutId = window.setTimeout(() => {
          void fail(
            new Error(
              'Aucun tag NFC détecté après 30 secondes. Approche un tag NDEF réinscriptible.',
            ),
          )
        }, 30_000)

        await CapacitorNfc.startScanning()
      } catch (error) {
        await fail(
          error instanceof Error
            ? error
            : new Error('Impossible de démarrer la session NFC de reset.'),
        )
      }
    })
  }

  if (!('NDEFReader' in window)) {
    throw new Error(
      'Le reset NFC n’est pas disponible dans ce navigateur. Utilise l’application native.',
    )
  }

  onProgress?.('Approche le tag NFC à effacer…')

  const writer = new NDEFReader()

  /*
   * Le Web NFC accepte un message NDEF vide.
   */
  await writer.write({
    records: [],
  })
}