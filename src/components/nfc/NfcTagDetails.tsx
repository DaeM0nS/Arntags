import { useEffect, useState } from 'react'

import {
  fetchArntrealProfile,
  markNfcTagAsWritten,
  updateNfcTagFavorite,
  updateNfcTagName,
  updateNfcTagProfile,
} from '../../services/nfcTagsRepository'
import { writeNfcTag } from '../../services/nfcService'
import type { NfcTag, ScannedNfcTag } from '../../types/nfc'
import NdefRecordsList from './NdefRecordsList'

type TagValue = NfcTag | ScannedNfcTag

type NfcTagDetailsProps = {
  tag: TagValue
  isSaved: boolean
  totalTags: number
  onClose: () => void
  onSavedChange: (tag: NfcTag) => void
  onMoveToPosition: (tagId: string, requestedPosition: number) => Promise<void>
}

function isStoredTag(tag: TagValue): tag is NfcTag {
  return 'id' in tag
}

function getUid(tag: TagValue): string | null {
  return isStoredTag(tag) ? tag.tag_uid : tag.uid
}

function getType(tag: TagValue): string | null {
  return isStoredTag(tag) ? tag.tag_type : tag.type
}

function getWritable(tag: TagValue): boolean | null {
  return isStoredTag(tag) ? tag.is_writable : tag.isWritable
}

function getPosition(tag: NfcTag, totalTags: number): number {
  const safePosition = tag.display_order || 1
  return Math.max(1, Math.min(safePosition, Math.max(totalTags, 1)))
}

export function findArntrealProfileUrl(tag: NfcTag): string | null {
  for (const record of tag.records) {
    const candidate =
      record.uri ??
      record.dataText ??
      record.text

    if (!candidate) {
      continue
    }

    try {
      const url = new URL(candidate)

      if (
        url.protocol === 'https:' &&
        url.hostname === 'profile.arntreal.com' &&
        /^\/[0-9a-f-]{36}\/?$/i.test(url.pathname)
      ) {
        const id = url.pathname.replace(/\//g, '')

        return `https://profile.arntreal.com/${id}`
      } else if (
        url.protocol === 'https:' &&
        url.hostname === 'app.arntreal.com' &&
        /^\/id\/[0-9a-f-]{36}\/?$/i.test(url.pathname)
      ) {
        const id = url.pathname
          .replace(/^\/id\//i, '')
          .replace(/\/$/, '')

        return `https://profile.arntreal.com/${id}`
      } else if (
        url.protocol === 'https:' &&
        url.hostname === 'app.arntreal.com' &&
        /^\/effect\/[0-9a-f-]{36}\/?$/i.test(url.pathname)
      ) {
        const id = url.pathname
          .replace(/^\/effect\//i, '')
          .replace(/\/$/, '')

        return `https://profile.arntreal.com/${id}`
      }
    } catch {
      // Ce record ne contient pas une URL valide.
    }
  }

  return null
}

export default function NfcTagDetails({
  tag,
  isSaved,
  totalTags,
  onClose,
  onSavedChange,
  onMoveToPosition,
}: NfcTagDetailsProps) {
  const [name, setName] = useState(isStoredTag(tag) ? tag.name : '')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState(
    isStoredTag(tag) ? String(getPosition(tag, totalTags)) : '1',
  )
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    setName(isStoredTag(tag) ? tag.name : '')
    setPosition(isStoredTag(tag) ? String(getPosition(tag, totalTags)) : '1')
    setStatus(null)
  }, [tag, totalTags])

  async function handleSaveName(): Promise<void> {
    if (!isStoredTag(tag)) return

    const cleanName = name.trim()

    if (!cleanName) {
      setStatus('Choisis un nom pour ce tag.')
      return
    }

    setLoading(true)
    setStatus(null)

    try {
      const updated = await updateNfcTagName(tag.id, cleanName)
      onSavedChange(updated)
      setStatus('Nom enregistré.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible d’enregistrer le nom.')
    } finally {
      setLoading(false)
    }
  }

  async function handleFavorite(): Promise<void> {
    if (!isStoredTag(tag)) return

    setLoading(true)
    setStatus(null)

    try {
      const updated = await updateNfcTagFavorite(tag.id, !tag.is_favorite)
      onSavedChange(updated)
      setStatus(updated.is_favorite ? 'Tag ajouté aux favoris.' : 'Tag retiré des favoris.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible de modifier le favori.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePosition(): Promise<void> {
    if (!isStoredTag(tag)) return

    const requestedPosition = Number.parseInt(position, 10)

    if (!Number.isInteger(requestedPosition)) {
      setStatus('Entre une position valide.')
      return
    }

    const clampedPosition = Math.max(1, Math.min(requestedPosition, totalTags))

    setLoading(true)
    setStatus(null)

    try {
      await onMoveToPosition(tag.id, clampedPosition)
      setPosition(String(clampedPosition))
      setStatus(`Tag déplacé à la position ${clampedPosition}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible de changer la position.')
    } finally {
      setLoading(false)
    }
  }

  async function handleWrite(): Promise<void> {
    setLoading(true)
    setStatus('Approche un tag NFC NDEF réinscriptible…')

    try {
      await writeNfcTag(tag.records, setStatus)

      if (isStoredTag(tag)) {
        const updatedTag = await markNfcTagAsWritten(tag.id)
        onSavedChange(updatedTag)
      }

      setStatus('Écriture terminée. Le contenu NDEF a été envoyé au tag.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible d’écrire le tag.')
    } finally {
      setLoading(false)
    }
  }

  const writable = getWritable(tag)
  const storedTag = isStoredTag(tag) ? tag : null

  async function handleRefreshArntrealProfile(): Promise<void> {
    if (!isStoredTag(tag)) {
      return
    }

    const profileUrl = findArntrealProfileUrl(tag)

    if (!profileUrl) {
      setProfileError(
        'Aucune URL de profil Arntreal n’a été trouvée dans ce tag.',
      )
      return
    }

    setProfileLoading(true)
    setProfileError(null)

    try {
      const profile = await fetchArntrealProfile(profileUrl)

      /*
       * Optionnel mais utile :
       * si la fonction ne reconnaît aucun vêtement, on informe clairement
       * l’utilisateur au lieu de stocker une réponse vide.
       */
      if (!profile.connected) {
        throw new Error(
          'Ce profil ne semble pas relié à un vêtement Arntreal actif.',
        )
      }

      const updatedTag = await updateNfcTagProfile(tag.id, profile)

      onSavedChange(updatedTag)
    } catch (refreshError) {
      setProfileError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Impossible de récupérer les informations Arntreal.',
      )
    } finally {
      setProfileLoading(false)
    }
  }

  return (
    <section className="nfc-detail app-surface" aria-label="Détail du tag NFC">
      <div className="nfc-detail__top">
        <div>
          <p className="app-eyebrow">{isSaved ? 'TAG SAUVEGARDÉ' : 'LECTURE EN MÉMOIRE'}</p>
          {isSaved ? (
            <input
              className="nfc-detail__name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Nom du tag"
            />
          ) : (
            <h2>Tag à sauvegarder</h2>
          )}
        </div>

        <button className="nfc-icon-button" type="button" onClick={onClose} aria-label="Fermer le détail">
          ×
        </button>
      </div>

      <div className="nfc-facts">
        <div><span>UID</span><strong>{getUid(tag) ?? 'Non disponible'}</strong></div>
        <div><span>Type</span><strong>{getType(tag) ?? 'NDEF'}</strong></div>
        <div><span>Écriture</span><strong>{writable === false ? 'Verrouillé' : 'À vérifier'}</strong></div>
        <div><span>Capacité</span><strong>{tag.capacity ? `${tag.capacity} octets` : 'Non disponible'}</strong></div>
      </div>

      {storedTag && (
        <section className="nfc-detail__organize" aria-label="Organisation du tag">
          <p className="app-eyebrow">ORGANISATION</p>

          <div className="nfc-detail__organize-grid">
            <button
              className={`nfc-favorite-button${storedTag.is_favorite ? ' nfc-favorite-button--active' : ''}`}
              type="button"
              disabled={loading}
              onClick={() => void handleFavorite()}
              aria-pressed={storedTag.is_favorite}
            >
              <span aria-hidden="true">{storedTag.is_favorite ? '★' : '☆'}</span>
              {storedTag.is_favorite ? 'Dans les favoris' : 'Ajouter aux favoris'}
            </button>

            <label className="app-field nfc-position-field">
              <span>Position dans la liste</span>
              <div className="nfc-position-field__control">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={Math.max(totalTags, 1)}
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handlePosition()
                    }
                  }}
                  aria-label="Position du tag dans la liste"
                />
                <button
                  className="app-button app-button--ghost"
                  type="button"
                  disabled={loading}
                  onClick={() => void handlePosition()}
                >
                  Placer
                </button>
              </div>
            </label>
          </div>

          <p className="nfc-detail__organize-help">
            Les favoris apparaissent en premier. La position organise les tags à l’intérieur de leur groupe.
          </p>
        </section>
      )}
      {isStoredTag(tag) && (
        <section className="arntreal-profile app-surface">
          <div className="arntreal-profile__header">
            <div>
              <p className="app-eyebrow">ARNTREAL PROFILE</p>
              <h2>Vêtement connecté</h2>
            </div>

            <button
              className="app-button app-button--ghost"
              type="button"
              disabled={profileLoading || loading}
              onClick={() => void handleRefreshArntrealProfile()}
            >
              {profileLoading ? 'Récupération…' : 'Actualiser'}
            </button>
          </div>

          {profileError && (
            <p className="app-message app-message--error">
              {profileError}
            </p>
          )}

          {!tag.profile_data ? (
            <div className="arntreal-profile__empty">
              <span aria-hidden="true">⌁</span>
              <p>
                Appuie sur « Actualiser » pour récupérer les informations visibles
                sur le profil Arntreal du tag.
              </p>
            </div>
          ) : (
            <div className="arntreal-profile__content">
              {tag.profile_data.clothingImageUrl && (
                <img
                  className="arntreal-profile__image"
                  src={tag.profile_data.clothingImageUrl}
                  alt={
                    tag.profile_data.clothingName ??
                    'Vêtement Arntreal'
                  }
                />
              )}

              <div className="arntreal-profile__facts">
                <div>
                  <span>Statut</span>
                  <strong>
                    {tag.profile_data.connected ? 'Connecté' : 'Non connecté'}
                  </strong>
                </div>

                <div>
                  <span>Propriétaire</span>
                  <strong>{tag.profile_data.owner ?? 'Inconnu'}</strong>
                </div>

                <div>
                  <span>Vêtement</span>
                  <strong>
                    {tag.profile_data.clothingName ?? 'Inconnu'}
                  </strong>
                </div>

                <div>
                  <span>Niveau</span>
                  <strong>
                    {tag.profile_data.clothingLevel ?? '—'}
                  </strong>
                </div>

                <div className="arntreal-profile__xp">
                  <span>XP niveau</span>
                  <strong>
                    {tag.profile_data.clothingXp.current?.toLocaleString('fr-FR') ?? '—'}
                    {' / '}
                    {tag.profile_data.clothingXp.required?.toLocaleString('fr-FR') ?? '—'}
                  </strong>
                </div>

                {/* <div>
                  <span>XP totale</span>
                  <strong>
                    {tag.profile_data.clothingXp.total?.toLocaleString('fr-FR') ?? '—'}
                  </strong>
                </div> */}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="nfc-detail__records-heading">
        <p className="app-eyebrow">CONTENU NDEF</p>
        <span>{tag.records.length} enregistrement(s)</span>
      </div>

      <NdefRecordsList records={tag.records} />

      {status && <p className="app-message app-message--success">{status}</p>}

      <div className="nfc-detail__actions">
        {isSaved && (
          <button className="app-button app-button--ghost" type="button" disabled={loading} onClick={() => void handleSaveName()}>
            Enregistrer le nom
          </button>
        )}

        <button className="app-button app-button--primary" type="button" disabled={loading || tag.records.length === 0} onClick={() => void handleWrite()}>
          {loading ? 'Traitement…' : 'Réécrire sur un tag'}
        </button>
      </div>
    </section>
  )
}