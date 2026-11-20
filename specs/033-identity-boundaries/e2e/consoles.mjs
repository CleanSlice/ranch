// CLEAN-236, Story 8: a sign-in belongs to the console it was made in. Two
// consoles on one host share a cookie jar; `jar` below is that jar. The two
// pages in one browser profile are checked by hand (quickstart.md §4).
import { api, check, done, section } from './lib.mjs';
import { login, seed } from './seed.mjs';

export async function run(people) {
  const { owner, u1 } = people;
  const jar = {};
  const who = async (console_, cookies = jar) => {
    const res = await api('POST', '/auth/refresh', { ...(console_ ? { console: console_ } : {}), cookies });
    return res.data?.user?.role ?? res.json?.code ?? `HTTP ${res.status}`;
  };

  section('two consoles, two accounts, one browser');
  await login(owner.email, { console: 'admin', cookies: jar });
  await login(u1.email, { console: 'app', cookies: jar });
  check('each console has a cookie of its own', Object.keys(jar).sort(), ['ranch_session_admin', 'ranch_session_app']);
  check('the app console renews the User', await who('app'), 'User');
  check('the admin console renews the Owner', await who('admin'), 'Owner');
  check('and again, in the other order, after both renewed', [await who('admin'), await who('app')], ['Owner', 'User']);

  section('a sign-in is not carried to the other console');
  check('the admin console\'s secret under the app\'s cookie name is refused', await who('app', { ranch_session_app: jar.ranch_session_admin }), 'SESSION_INVALID');
  check('  … and the admin console\'s sign-in survives the attempt', await who('admin'), 'Owner');
  check('the cookie the consoles used to share is never read', await who('admin', { ranch_session: jar.ranch_session_admin }), 'SESSION_MISSING');
  check('a request that names no console renews nothing', await who(null), 'SESSION_INVALID');

  section('a script that signs in for a token');
  const script = await api('POST', '/auth/login', { body: { email: u1.email, password: 'e2e-Passw0rd!' } });
  check('gets its token', [script.status === 200 || script.status === 201, typeof script.data?.accessToken], [true, 'string']);
  check('  … and no cookie', script.setCookies, []);

  section('signing out of one console');
  const out = await api('POST', '/auth/logout', { console: 'app', cookies: jar });
  check('the app console signs out', [out.status === 200 || out.status === 201, 'ranch_session_app' in jar], [true, false]);
  check('the app console is signed out', await who('app'), /SESSION_/);
  check('the admin console is still the Owner', await who('admin'), 'Owner');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
