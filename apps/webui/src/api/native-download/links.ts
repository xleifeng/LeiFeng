import { linkItemSchema, linkQuerySchema } from '../contracts/v2/links'
import { rpcV2 } from './client'

export async function queryLinks(options: Record<string, unknown> = {}) { return linkQuerySchema.parse(await rpcV2('thunder.ui.v2.links.query', [options])) }
export async function getLink(linkId: string) { return linkItemSchema.parse(await rpcV2('thunder.ui.v2.links.get', [{ linkId }])) }
export async function saveLink(input: Record<string, unknown>) { return linkItemSchema.parse(await rpcV2('thunder.ui.v2.links.save', [input])) }
export async function setLinkFavorite(linkId: string, favorite: boolean, expectedRevision?: number) { return linkItemSchema.parse(await rpcV2('thunder.ui.v2.links.setFavorite', [{ linkId, favorite, expectedRevision }])) }
export async function setLinkTags(linkId: string, tags: string[], expectedRevision?: number) { return linkItemSchema.parse(await rpcV2('thunder.ui.v2.links.setTags', [{ linkId, tags, expectedRevision }])) }
export async function removeLinks(linkIds: string[], privateMode = false) { return rpcV2<{ removed: number }>('thunder.ui.v2.links.remove', [{ linkIds, privateMode }]) }
export async function createDraftFromLink(linkId: string) { return rpcV2('thunder.ui.v2.links.createDraft', [{ linkId }]) }
