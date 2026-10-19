/**
 * The calculation behind a Calculate field.
 *
 * This is deliberately a sum and not a language: numbers, the ids of other questions of
 * this form written in braces, and `+ - * / ( )`. Nothing else can be written, so nothing
 * else has to be sandboxed — there is no property access, no call and no `eval` anywhere
 * in here. The number a visitor sees on the page and the number stored with the response
 * come from the same function, so they cannot disagree.
 */

/** A calculation this long is a spreadsheet pasted into a box, not a sum. */
export const FORMULA_MAX_CHARS = 500;

/** More questions than this in one sum belongs somewhere else. */
export const FORMULA_MAX_REFERENCES = 12;

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'reference'; id: string }
  | { kind: 'negate'; of: Node }
  | { kind: 'operate'; operator: '+' | '-' | '*' | '/'; left: Node; right: Node };

/** A field id, as it is written inside braces. `formFieldSchema` is what constrains it. */
const REFERENCE = /\{([a-zA-Z0-9_-]{1,64})\}/;
const NUMBER = /\d+(?:\.\d+)?|\.\d+/;

type Token = { text: string; node?: Node };

/** Every question the calculation reads, in the order they are written, without repeats. */
export function formulaReferences(expression: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(REFERENCE.source, 'g');
  let match = pattern.exec(expression);
  while (match) {
    const id = match[1];
    if (id && !found.includes(id)) found.push(id);
    match = pattern.exec(expression);
  }
  return found;
}

/**
 * What is wrong with the calculation as written, or `null` when it can be worked out.
 *
 * The sentences are for the person building the form, through Publish, so each one says
 * what to change rather than where the parser tripped.
 */
export function formulaProblem(expression: string): string | null {
  const trimmed = expression.trim();
  if (trimmed === '') return 'has no calculation';
  if (trimmed.length > FORMULA_MAX_CHARS) return `is longer than ${FORMULA_MAX_CHARS} characters`;
  const references = formulaReferences(trimmed);
  if (references.length === 0) return 'reads no question from this form';
  if (references.length > FORMULA_MAX_REFERENCES) return `reads more than ${FORMULA_MAX_REFERENCES} questions`;
  const parsed = parse(trimmed);
  return 'error' in parsed ? parsed.error : null;
}

/**
 * Work the sum out. `read` gives the number a question was answered with, and a question
 * left blank — or not reached yet — reads as zero, the way a total in a spreadsheet does.
 * `null` is the answer that cannot be written down, like a division by zero.
 */
export function evaluateFormula(expression: string, read: (id: string) => number): number | null {
  const parsed = parse(expression.trim());
  if ('error' in parsed) return null;
  return valueOf(parsed.root, read);
}

/**
 * One answer read as a number for a sum. A question nobody answered is zero, and so is
 * one holding something that is not a number: a sum never invents a value, and a form
 * that is only half filled in still adds up to what has been written so far.
 */
export function numberAnswer(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : 0;
}

function parse(expression: string): { root: Node } | { error: string } {
  let at = 0;

  const skipSpace = () => {
    while (at < expression.length && expression[at] === ' ') at += 1;
  };

  const peek = (): Token => {
    skipSpace();
    const rest = expression.slice(at);
    const reference = REFERENCE.exec(rest);
    if (reference && reference.index === 0) {
      return { text: rest.slice(0, reference[0].length), node: { kind: 'reference', id: reference[1]! } };
    }
    const number = NUMBER.exec(rest);
    if (number && number.index === 0) return { text: number[0], node: { kind: 'number', value: Number(number[0]) } };
    // One character of anything else — an operator, a bracket, or something that has no
    // business in a sum. `''` is the only answer that means nothing was left to read.
    return { text: rest.slice(0, 1) };
  };

  const take = (text: string): boolean => {
    if (peek().text !== text) return false;
    at += text.length;
    return true;
  };

  /** `number`, `reference`, `( sum )` or a negation of one of those. */
  const parseFactor = (): { node: Node } | { error: string } => {
    if (take('-')) {
      const arg = parseFactor();
      return 'error' in arg ? arg : { node: { kind: 'negate', of: arg.node } };
    }
    if (take('(')) {
      const inner = parseSum();
      if ('error' in inner) return inner;
      if (!take(')')) return { error: 'has a bracket left open' };
      return { node: inner.node };
    }
    const token = peek();
    if (!token.node) {
      return { error: token.text === '' ? 'ends where a number or a question was due' : 'holds something that is not a number or a question' };
    }
    at += token.text.length;
    return { node: token.node };
  };

  const parseProduct = (): { node: Node } | { error: string } => {
    let left = parseFactor();
    if ('error' in left) return left;
    for (;;) {
      const op = take('*') ? '*' : take('/') ? '/' : null;
      if (op === null) return left;
      const right = parseFactor();
      if ('error' in right) return right;
      left = { node: { kind: 'operate', operator: op, left: left.node, right: right.node } };
    }
  };

  const parseSum = (): { node: Node } | { error: string } => {
    let left = parseProduct();
    if ('error' in left) return left;
    for (;;) {
      const op = take('+') ? '+' : take('-') ? '-' : null;
      if (op === null) return left;
      const right = parseProduct();
      if ('error' in right) return right;
      left = { node: { kind: 'operate', operator: op, left: left.node, right: right.node } };
    }
  };

  const sum = parseSum();
  if ('error' in sum) return { error: sum.error };
  skipSpace();
  if (at < expression.length) return { error: 'has something left over at the end' };
  return { root: sum.node };
}

function valueOf(node: Node, read: (id: string) => number): number | null {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'reference': {
      const value = read(node.id);
      return Number.isFinite(value) ? value : null;
    }
    case 'negate': {
      const arg = valueOf(node.of, read);
      return arg === null ? null : -arg;
    }
    case 'operate': {
      const left = valueOf(node.left, read);
      const right = valueOf(node.right, read);
      if (left === null || right === null) return null;
      if (node.operator === '+') return left + right;
      if (node.operator === '-') return left - right;
      if (node.operator === '*') return left * right;
      return right === 0 ? null : left / right;
    }
  }
}
