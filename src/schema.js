// A small schema checker. Each station declares the shape of its input with it, the same way a
// ParseRail endpoint declares a body schema. No dependency.
//
//   const S = obj({ query: str({ min: 1 }), urls: arr(str()) }, { optional: ['urls'] });
//   const errors = check(S, value);   // [] when valid, else ['urls[0]: expected string', ...]

export const str = (o = {}) => ({ type: 'string', ...o });
export const num = (o = {}) => ({ type: 'number', ...o });
export const bool = () => ({ type: 'boolean' });
export const arr = (items, o = {}) => ({ type: 'array', items, ...o });
export const obj = (props, o = {}) => ({ type: 'object', props, optional: o.optional || [], open: o.open !== false });
export const oneOf = (values) => ({ type: 'enum', values });
export const any = () => ({ type: 'any' });

export function check(schema, value, path = '') {
  const at = path || 'input';
  const errs = [];
  switch (schema.type) {
    case 'any':
      return errs;
    case 'string':
      if (typeof value !== 'string') return [`${at}: expected string`];
      if (schema.min != null && value.length < schema.min) errs.push(`${at}: shorter than ${schema.min}`);
      if (schema.max != null && value.length > schema.max) errs.push(`${at}: longer than ${schema.max}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
      return errs;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${at}: expected number`];
      if (schema.min != null && value < schema.min) errs.push(`${at}: below ${schema.min}`);
      if (schema.max != null && value > schema.max) errs.push(`${at}: above ${schema.max}`);
      return errs;
    case 'boolean':
      return typeof value === 'boolean' ? errs : [`${at}: expected boolean`];
    case 'enum':
      return schema.values.includes(value) ? errs : [`${at}: expected one of ${schema.values.join(', ')}`];
    case 'array':
      if (!Array.isArray(value)) return [`${at}: expected array`];
      if (schema.min != null && value.length < schema.min) errs.push(`${at}: fewer than ${schema.min} items`);
      if (schema.max != null && value.length > schema.max) errs.push(`${at}: more than ${schema.max} items`);
      value.forEach((v, i) => errs.push(...check(schema.items, v, `${at}[${i}]`)));
      return errs;
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected object`];
      for (const [k, s] of Object.entries(schema.props)) {
        const p = path ? `${path}.${k}` : k;
        if (value[k] === undefined || value[k] === null) {
          if (!schema.optional.includes(k)) errs.push(`${p}: required`);
          continue;
        }
        errs.push(...check(s, value[k], p));
      }
      if (!schema.open) {
        for (const k of Object.keys(value)) if (!(k in schema.props)) errs.push(`${path ? `${path}.` : ''}${k}: unknown key`);
      }
      return errs;
    }
    default:
      throw new Error(`unknown schema type ${schema.type}`);
  }
}
