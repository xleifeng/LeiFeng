import { accountStatusSchema, loginStartSchema } from '../contracts/v2/account'
import { rpcV2 } from './client'

export async function getAccountStatus(refresh = false) { return accountStatusSchema.parse(await rpcV2(refresh ? 'leifeng.ui.v2.account.refresh' : 'leifeng.ui.v2.account.get')) }
export async function startAccountLogin() { return loginStartSchema.parse(await rpcV2('leifeng.ui.v2.account.startLogin', [{}])) }
export async function cancelAccountLogin() { return rpcV2<{ cancelled: boolean }>('leifeng.ui.v2.account.cancelLogin') }
export async function logoutAccount() { return rpcV2<{ loggedOut?: boolean }>('leifeng.ui.v2.account.logout') }
