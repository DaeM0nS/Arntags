import { findArntrealProfileUrl } from '../components/nfc/NfcTagDetails'
import { supabase } from '../supabaseClient'
import type { ArntrealProfileData, NfcTag, NfcTagInsert } from '../types/nfc'

const tableName = 'nfc_tags'

function asNfcTag(value: unknown): NfcTag {
  return value as NfcTag
}

export async function getNfcTags(): Promise<NfcTag[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map(asNfcTag)
}

export async function createNfcTag(payload: NfcTagInsert): Promise<NfcTag> {
  const { data, error } = await supabase
    .from(tableName)
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return asNfcTag(data)
}

export async function updateNfcTagName(id: string, name: string): Promise<NfcTag> {
  const { data, error } = await supabase
    .from(tableName)
    .update({ name })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return asNfcTag(data)
}

export async function markNfcTagAsWritten(id: string): Promise<NfcTag> {
  const { data, error } = await supabase
    .from(tableName)
    .update({ written_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return asNfcTag(data)
}

export async function deleteNfcTag(id: string): Promise<void> {
  const { error } = await supabase.from(tableName).delete().eq('id', id)
  if (error) throw error
}

export async function updateNfcTagsOrder(
  orderedTagIds: string[],
): Promise<void> {
  const updates = orderedTagIds.map((id, index) => ({
    id,
    display_order: index + 1,
  }))

  /*
   * On fait une requête par tag : c'est très simple et suffisamment fiable
   * pour une petite collection personnelle de tags.
   *
   * Les policies RLS empêchent un utilisateur de modifier les tags
   * d’un autre utilisateur.
   */
  const results = await Promise.all(
    updates.map(({ id, display_order }) =>
      supabase
        .from(tableName)
        .update({ display_order })
        .eq('id', id),
    ),
  )

  const failure = results.find((result) => result.error)

  if (failure?.error) {
    throw failure.error
  }
}

export async function updateNfcTagFavorite(
  id: string,
  isFavorite: boolean,
): Promise<NfcTag> {
  const { data, error } = await supabase
    .from(tableName)
    .update({ is_favorite: isFavorite })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return asNfcTag(data)
}

export async function updateNfcTagPosition(
  id: string,
  displayOrder: number,
): Promise<NfcTag> {
  const { data, error } = await supabase
    .from(tableName)
    .update({ display_order: displayOrder })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return asNfcTag(data)
}

export async function fetchArntrealProfile(
  url: string,
): Promise<ArntrealProfileData> {
  const { data, error } = await supabase.functions.invoke(
    'scrape-arntreal-profile',
    {
      body: {
        url,
      },
    },
  )

  console.log(data);

  if (error) {
    throw error
  }

  /*
   * L’Edge Function renvoie un éventuel message dans `error`
   * avec un code HTTP 200/400 selon sa configuration.
   */
  if (
    !data ||
    typeof data !== 'object' ||
    ('error' in data && typeof data.error === 'string')
  ) {
    const details =
      data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string'
        ? data.error
        : 'Réponse Arntreal invalide.'

    throw new Error(details)
  }

  return data as ArntrealProfileData
}

export async function updateNfcTagProfile(
  id: string,
  profile: ArntrealProfileData,
): Promise<NfcTag> {
  const { data, error } = await supabase
    .from(tableName)
    .update({
      profile_data: profile,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return asNfcTag(data)
}

export async function refreshAllArntrealProfiles(): Promise<void> {
  const { data: tags, error } = await supabase
    .from(tableName)
    .select('id, records, profile_data')

  if (error) {
    console.error('Impossible de charger les tags pour rafraîchir les profils Arntreal.', error)
    return
  }

  const storedTags = tags.filter(
    (t): t is NfcTag & { profile_data: null } =>
      !t.profile_data
  )

  await Promise.allSettled(
    storedTags.map(async (tag) => {
      const profileUrl = findArntrealProfileUrl(tag)

      if (!profileUrl) {
        return
      }

      try {
        const profile = await fetchArntrealProfile(profileUrl)

        if (!profile.connected) {
          return
        }

        await updateNfcTagProfile(tag.id, profile)
      } catch (refreshError) {
        console.log(
          `Échec du rafraîchissement du profil Arntreal pour le tag ${tag.id}.`,
          refreshError,
        )
      }
    }),
  )
}

export async function tryAttachArntrealProfile(
  tag: NfcTag,
): Promise<NfcTag | null> {
  // On ne traite que les tags stockés (avec id)
  if (!('id' in tag) || !tag.id) {
    return null
  }

  // Si le tag a déjà un profil récent, on skip
  if (tag.profile_data?.connected) {
    return tag
  }

  const profileUrl = findArntrealProfileUrl(tag)

  if (!profileUrl) {
    return null
  }

  try {
    const profile = await fetchArntrealProfile(profileUrl)

    if (!profile.connected) {
      return null
    }

    const updated = await updateNfcTagProfile(tag.id, profile)

    return updated
  } catch (error) {
    console.warn(
      `Impossible d'attacher le profil Arntreal au tag ${tag.id}.`,
      error,
    )
    return null
  }
}