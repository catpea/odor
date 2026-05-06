/**
 * A small, beautiful XML parser for well-formed input.
 *
 * XML is a self-similar grammar: an element contains nodes, and a node
 * may itself be an element. So is this parser. The same routine,
 * `#parseNodes`, walks both the top of the document and the body of
 * every element -- the only thing that changes between calls is where
 * it stops. The shape of the parser echoes the shape of the language.
 *
 *     parseNodes ─────┐
 *          ↓          │  children of an element are themselves nodes,
 *     parseElement ───┘  so we recurse straight back into parseNodes.
 *
 * Output shape (a simple tree of plain objects):
 *
 *     element  →  { type: 'element', name, attributes, children }
 *     text     →  { type: 'text',    value }
 *     comment  →  { type: 'comment', value }
 *
 *  Supported:
 *    ✓ Elements (paired and self-closing)
 *    ✓ Attributes in single OR double quotes; HTML entities decoded
 *    ✓ Text with HTML entities (named and numeric, decimal & hex)
 *    ✓ Comments
 *    ✓ Rootless documents -- zero, one, or many top-level nodes
 *    ✓ XML declarations and DOCTYPE (skipped over)
 *
 *  Deliberately omitted (per the brief):
 *    ✗ Namespaces (a colon in a name is just part of the name)
 *    ✗ CDATA sections
 *
 *  Input must be well-formed. No error recovery is attempted; malformed
 *  input throws a SyntaxError pointing at the offending position.
 *
 *  Usage:
 *
 *      import { parse } from './parse.js';
 *      const tree = parse('<greeting to="world">hello</greeting>');
 */

// The five entities XML always recognizes by name. Anything else named
// is left intact; numeric character references (&#65; / &#x41;) are
// handled by the regex branch.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g;

const decodeEntities = (text) =>
  text.replace(ENTITY_RE, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });

// Practical ASCII subset of the XML name production. The colon is
// allowed so namespaced names like `svg:rect` parse cleanly -- we just
// don't interpret the prefix.
const NAME_CHAR = /[A-Za-z0-9_\-.:]/;

class Parser {
  #src;
  #pos = 0;

  constructor(src) {
    this.#src = String(src);
  }

  // ─── micro-helpers ────────────────────────────────────────────────────
  // Each one advances `#pos` (or doesn't) and is named for what it does.
  // The grammar functions below read like prose because of them.

  #peek(literal) {
    return this.#src.startsWith(literal, this.#pos);
  }

  #consume(literal) {
    if (!this.#peek(literal)) {
      throw new SyntaxError(`Expected "${literal}" at position ${this.#pos}`);
    }
    this.#pos += literal.length;
  }

  #skipSpace() {
    while (this.#pos < this.#src.length && /\s/.test(this.#src[this.#pos])) {
      this.#pos++;
    }
  }

  #readWhile(predicate) {
    const start = this.#pos;
    while (this.#pos < this.#src.length && predicate(this.#src[this.#pos])) {
      this.#pos++;
    }
    return this.#src.slice(start, this.#pos);
  }

  // ─── grammar ──────────────────────────────────────────────────────────

  /**
   * A document is just a sequence of nodes. Optional XML declaration
   * and DOCTYPE are skipped first; everything after -- including
   * sibling elements at the top level, stray text, or comments -- is
   * returned as an array. This is what makes rootless documents work
   * for free.
   */
  parse() {
    this.#skipProlog();
    return this.#parseNodes(() => this.#pos >= this.#src.length);
  }

  #skipProlog() {
    this.#skipSpace();

    // <?xml ... ?> and any other processing instructions.
    while (this.#peek('<?')) {
      const end = this.#src.indexOf('?>', this.#pos);
      if (end === -1) throw new SyntaxError('Unterminated processing instruction');
      this.#pos = end + 2;
      this.#skipSpace();
    }

    // <!DOCTYPE ...> -- may contain a `[ ... ]` internal subset, so we
    // walk by hand and only stop at a `>` outside any brackets.
    if (this.#peek('<!DOCTYPE')) {
      let depth = 0;
      while (this.#pos < this.#src.length) {
        const c = this.#src[this.#pos++];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth === 0) break;
      }
      this.#skipSpace();
    }
  }

  /**
   * Read nodes until `done()` returns true (or input is exhausted).
   * This is the self-similar core: the body of the document and the
   * body of every element are parsed by this same function. They
   * differ only in the predicate they pass for "you can stop now".
   */
  #parseNodes(done) {
    const nodes = [];
    while (this.#pos < this.#src.length && !done()) {
      const node = this.#parseNode();
      if (node !== null) nodes.push(node);
    }
    return nodes;
  }

  // One node is one of three things. The first character (or two)
  // tells us which.
  #parseNode() {
    if (this.#peek('<!--')) return this.#parseComment();
    if (this.#peek('<'))    return this.#parseElement();
    return this.#parseText();
  }

  #parseComment() {
    this.#consume('<!--');
    const end = this.#src.indexOf('-->', this.#pos);
    if (end === -1) throw new SyntaxError('Unterminated comment');
    const value = this.#src.slice(this.#pos, end);
    this.#pos = end + 3;
    return { type: 'comment', value };
  }

  #parseElement() {
    this.#consume('<');
    const name = this.#readWhile((c) => NAME_CHAR.test(c));
    if (!name) {
      throw new SyntaxError(`Expected tag name at position ${this.#pos}`);
    }
    const attributes = this.#parseAttributes();
    this.#skipSpace();

    // <name ... />  -- a leaf, no body to recurse into.
    if (this.#peek('/>')) {
      this.#pos += 2;
      return { type: 'element', name, attributes, children: [] };
    }

    // <name ...> children </name>  -- here is the recursion. The body
    // is just more nodes, parsed by the very same function that's
    // parsing the document.
    this.#consume('>');
    const closeTag = `</${name}`;
    const children = this.#parseNodes(() => this.#peek(closeTag));
    this.#consume(closeTag);
    this.#skipSpace();          // tolerate `</foo  >`
    this.#consume('>');

    return { type: 'element', name, attributes, children };
  }

  #parseAttributes() {
    const attributes = {};
    while (true) {
      this.#skipSpace();
      const c = this.#src[this.#pos];
      // We're done with attributes when the open tag is about to end:
      // either `>` (paired element) or `/` (self-closing) or EOF.
      if (!c || c === '/' || c === '>') break;

      const name = this.#readWhile((ch) => NAME_CHAR.test(ch));
      if (!name) {
        throw new SyntaxError(`Expected attribute name at position ${this.#pos}`);
      }
      this.#skipSpace();
      this.#consume('=');
      this.#skipSpace();

      const quote = this.#src[this.#pos];
      if (quote !== '"' && quote !== "'") {
        throw new SyntaxError(`Expected quoted attribute value at position ${this.#pos}`);
      }
      this.#pos++;
      const raw = this.#readWhile((ch) => ch !== quote);
      this.#consume(quote);
      attributes[name] = decodeEntities(raw);
    }
    return attributes;
  }

  // Text runs from here up to the next `<`. Pure-whitespace runs are
  // kept (callers can decide whether to ignore them); empty runs are
  // dropped so we never emit a useless node.
  #parseText() {
    const raw = this.#readWhile((c) => c !== '<');
    return raw.length === 0 ? null : { type: 'text', value: decodeEntities(raw) };
  }
}

/**
 * Parse a well-formed XML string into an array of top-level nodes.
 *
 * @param {string} source  the XML to parse
 * @returns {Array<{type: string} & object>}  the node tree
 */
export const parse = (source) => new Parser(source).parse();
