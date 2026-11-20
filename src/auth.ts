import {clearSession,jarFromSession,loadSession} from './session.js';
import {createClient,loggedIn} from './http.js';
import {cancelActive} from './login-task.js';
import {PiggyError} from './errors.js';
export async function authStatus():Promise<unknown>{
 const session=await loadSession();
 if(!await loggedIn(createClient(await jarFromSession(session))))throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
 return {authenticated:true,savedAt:session.savedAt};
}
export async function authLogout():Promise<unknown>{
 await cancelActive();await clearSession();
 return {authenticated:false,scope:'Active login cancelled and local session removed; other official browser sessions are unaffected.'};
}
