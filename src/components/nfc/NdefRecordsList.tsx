import type { JSX } from 'react/jsx-runtime'
import type { NdefRecord } from '../../types/nfc'

type NdefRecordsListProps = {
  records: NdefRecord[]
}

function labelForRecord(record: NdefRecord): string {
  if (record.recordType === 'text') return 'Texte'
  if (record.recordType === 'url' || record.recordType === 'absolute-url') return 'Lien'
  if (record.recordType === 'mime') return record.mediaType ?? 'MIME'
  return record.recordType || 'Inconnu'
}

function contentForRecord(record: NdefRecord): string {
  return record.text ?? record.uri ?? record.dataText ?? 'Données binaires non affichables'
}

export default function NdefRecordsList({ records }: NdefRecordsListProps): JSX.Element {
  if (records.length === 0) {
    return <p className="nfc-empty-records">Aucun enregistrement NDEF trouvé.</p>
  }

  return (
    <div className="ndef-records">
      {records.map((record, index) => (
        <article className="ndef-record" key={`${record.id ?? 'record'}-${index}`}>
          <span className="ndef-record__number">{String(index + 1).padStart(2, '0')}</span>
          <div className="ndef-record__content">
            <p className="ndef-record__type">{labelForRecord(record)}</p>
            <p className="ndef-record__value">{(record.recordType === 'url' || record.recordType === 'absolute-url') ? <a href={contentForRecord(record)}>{contentForRecord(record)}</a> : <>{contentForRecord(record)}</>}</p>
          </div>
        </article>
      ))}
    </div>
  )
}