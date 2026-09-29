// entryPoint is a named, closure-free function. helpers are the imported pure
// functions it calls; their exact source is embedded, with no copied logic.
export function buildCodeNodeSource(entryPoint, helpers = []) {
  if (typeof entryPoint !== 'function' || !Array.isArray(helpers) || helpers.some((helper) => typeof helper !== 'function')) {
    throw new TypeError('Expected an entry function and an array of helper functions');
  }
  const functions = [...new Set([...helpers, entryPoint])];
  for (const fn of functions) {
    if (!/^[A-Za-z_$][\w$]*$/.test(fn.name) || !/^function\s+[A-Za-z_$][\w$]*\s*\(/.test(fn.toString())) {
      throw new TypeError('Code-node functions must be named declarations');
    }
  }
  return `${functions.map((fn) => fn.toString()).join('\n\n')}\n\nconst input = $input.first()?.json ?? {};\nreturn [{ json: ${entryPoint.name}(input) }];`;
}
