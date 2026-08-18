// dsh-hover-approve node half: pure UI plugin. The empty apply exists so the
// plugin appears in the host cordis.yml / Loader (load and lifecycle follow
// the host); the browser half ships via exports["./client"], discovered
// through the package.json dsh.client declaration.
export function apply() {}
