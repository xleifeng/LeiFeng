import { accountStatusSchema, loginStartSchema } from '../contracts/v2/account'
import { rpcV2 } from './client'

export async function getAccountStatus(refresh = false) { return accountStatusSchema.parse(await rpcV2(refresh ? 'thunder.ui.v2.account.refresh' : 'thunder.ui.v2.account.get')) }
export async function startAccountLogin() { return loginStartSchema.parse(await rpcV2('thunder.ui.v2.account.startLogin', [{}])) }
export async function cancelAccountLogin() { return rpcV2<{ cancelled: boolean }>('thunder.ui.v2.account.cancelLogin') }
export async function logoutAccount() { return rpcV2<{ loggedOut?: boolean }>('thunder.ui.v2.account.logout') }
